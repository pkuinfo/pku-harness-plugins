/**
 * All of this plugin's shares: starts them, re-attaches active ones after an app restart
 * (channels survive restarts in the host; records live in the plugin's kv), and keeps a short
 * history for the summary ("本次共享消费 ¥18.50（2 笔）"). One instance per plugin runtime,
 * shared by screens and tools.
 */
import { CloudError, type HostServices, type KV, type PluginCloud } from '@pku-harness/sdk';

import { realClock, ShareSession, type Clock, type OngoingText, type ShareConfig, type ShareRecord } from './session';
import { cardSource, MockSource, type CodeSource } from './source';

export const SHARES_KEY = 'shares';
export const DRAFT_KEY = 'draft';
export const MOCK_KEY = 'dev.mockSource';
/** Ended shares kept for the history list. */
export const HISTORY = 20;

export type ManagerDeps = {
  kv: KV;
  cloud?: PluginCloud;
  source: CodeSource;
  clock?: Clock;
  ongoing?: HostServices['ongoing'];
  ongoingText?: OngoingText;
  refreshMs?: number;
};

export class ShareManager {
  private sessions = new Map<string, ShareSession>();
  private records = new Map<string, ShareRecord>();
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private version = 0;

  constructor(private deps: ManagerDeps) {}

  /** Newer cloud client / locale texts from a later screen or tool call. */
  update(deps: Partial<ManagerDeps>) {
    this.deps = { ...this.deps, ...Object.fromEntries(Object.entries(deps).filter(([, v]) => v !== undefined)) };
  }

  get source() {
    return this.deps.source;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Bumps on every change (for React's useSyncExternalStore-style re-render). */
  getVersion() {
    return this.version;
  }

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private persist = (record: ShareRecord): Promise<void> => {
    this.records.set(record.id, record);
    this.emit();
    const all = [...this.records.values()];
    const active = all.filter((r) => r.status === 'active');
    const ended = all
      .filter((r) => r.status === 'ended')
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, HISTORY);
    for (const r of all) if (r.status === 'ended' && !ended.includes(r)) this.records.delete(r.id);
    const snapshot = JSON.parse(JSON.stringify([...active, ...ended])) as ShareRecord[];
    this.writing = this.writing.then(() => this.deps.kv.set(SHARES_KEY, snapshot)).catch(() => {});
    return this.writing;
  };

  private sessionDeps() {
    const cloud = this.deps.cloud;
    if (!cloud) throw new CloudError('not_configured', '没有可用的云服务：在 设置 → 云服务 里选择一个服务');
    return { cloud, source: this.deps.source, clock: this.deps.clock, persist: this.persist, ongoing: this.deps.ongoing, ongoingText: this.deps.ongoingText, refreshMs: this.deps.refreshMs };
  }

  /** Load records and re-attach active shares (idempotent). */
  load(): Promise<void> {
    return (this.loading ??= this.doLoad());
  }

  private async doLoad() {
    const saved = (await this.deps.kv.get<ShareRecord[]>(SHARES_KEY)) ?? [];
    const now = (this.deps.clock ?? realClock).now();
    for (const r of saved) {
      if (this.records.has(r.id)) continue;
      this.records.set(r.id, r);
      if (r.status !== 'active') continue;
      const channel = this.deps.cloud?.channels.get(r.id);
      if (!channel || channel.expiresAt <= now) {
        Object.assign(r, { status: 'ended', endReason: channel ? 'expired' : 'server', endedAt: Math.min(now, r.expiresAt) });
        delete r.secret;
        continue;
      }
      try {
        this.sessions.set(r.id, await ShareSession.resume(this.sessionDeps(), channel, r));
      } catch {
        // cloud not available right now: keep the record active, retry on the next load
        this.loading = null;
      }
    }
    this.emit();
  }

  /** Active first (newest first), then history. */
  list(): ShareRecord[] {
    const all = [...this.records.values()];
    return [...all.filter((r) => r.status === 'active').sort((a, b) => b.createdAt - a.createdAt), ...all.filter((r) => r.status === 'ended').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))];
  }

  get(id: string): ShareSession | undefined {
    return this.sessions.get(id);
  }

  record(id: string): ShareRecord | undefined {
    return this.records.get(id);
  }

  async start(config: ShareConfig): Promise<ShareSession> {
    await this.load();
    await this.deps.source.ready();
    const s = await ShareSession.start(this.sessionDeps(), config);
    this.sessions.set(s.id, s);
    return s;
  }

  async stop(id: string): Promise<boolean> {
    await this.load();
    const s = this.sessions.get(id);
    if (!s?.active) return false;
    await s.end('owner');
    return true;
  }

  async stopAll(): Promise<string[]> {
    await this.load();
    const ids = [...this.sessions.values()].filter((s) => s.active).map((s) => s.id);
    for (const id of ids) await this.stop(id);
    return ids;
  }

  async extend(id: string, ttlS: number) {
    await this.sessions.get(id)?.extend(ttlS);
  }

  /** Let a different person open the same link (the relay frees the viewer's seat). */
  async resetViewer(id: string): Promise<void> {
    await this.sessions.get(id)?.kickViewer();
  }
}

// ── one manager per plugin runtime ──────────────────────────────────────────────────────────

let shared: ShareManager | null = null;
let sharedMock: boolean | null = null;

/**
 * The plugin's manager, created on first use. `mock` (dev toggle) switches the code source;
 * switching is refused while a share is active.
 */
export function shareManager(input: { kv: KV; services: Pick<HostServices, 'campus' | 'ongoing'>; cloud?: PluginCloud; mock?: boolean; ongoingText?: OngoingText }): ShareManager {
  const mock = input.mock ?? sharedMock ?? false;
  if (shared && sharedMock !== mock && !shared.list().some((r) => r.status === 'active')) shared = null;
  if (!shared) {
    shared = new ShareManager({ kv: input.kv, cloud: input.cloud, source: mock ? new MockSource() : cardSource(input.services), ongoing: input.services.ongoing, ongoingText: input.ongoingText });
    sharedMock = mock;
  } else shared.update({ cloud: input.cloud, ongoing: input.services.ongoing, ongoingText: input.ongoingText });
  return shared;
}

/** Tests only. */
export function resetShareManager() {
  shared = null;
  sharedMock = null;
}
