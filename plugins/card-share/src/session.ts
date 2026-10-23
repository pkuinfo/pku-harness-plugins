/**
 * One live share (docs/CLOUD.md §1.3, §3.3): a cloud channel ↔ the code loop on this phone.
 *
 * - The viewer joins the channel (the relay lets one viewer claim it: maxPeers 1).
 * - Gates (PIN, masked name) are checked here; 5 wrong answers close the share.
 * - A verified, connected viewer gets a fresh code every 25 s, or at once when it asks (`want`).
 * - The spend cap is polled from the card's turnover at +20/+60/+120 s after each code and
 *   every 2 min; reaching it closes the share.
 * - The share closes itself on expiry, cap, lockout or when the relay closes the channel.
 *
 * Codes only ever go into the channel (sealed per viewer by the host). They are never logged,
 * persisted or returned to the agent.
 */
import type { Channel, ChannelCloseReason, ChannelEvent, HostServices, OngoingHandle, PluginCloud } from '@pku-harness/sdk';

import { CAP_CHECKS_AFTER_CODE_MS, CAP_POLL_MS, evaluateCap, type SharePayment } from './cap';
import { checkName, checkPin, maskName, MAX_GATE_FAILURES } from './gates';
import { gatesOf, parseViewerFrame, FRAME_VERSION, type EndReason, type GateKind, type OwnerFrame, type ShareMeta } from './protocol';
import { NotDigitalError, type CodeSource } from './source';

/** Timers behind an interface so tests drive a fake clock. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Push a fresh code this often while a verified viewer is connected. */
export const CODE_REFRESH_MS = 25_000;
/** A `want` within this long of the last code gets that code again instead of a new one. */
export const WANT_MIN_GAP_MS = 5_000;

/** What the sharer chose in the create sheet. */
export type ShareConfig = {
  ttlS: number;
  /** Yuan; null = no cap. */
  capYuan: number | null;
  /** 4–8 digits; null = no PIN. */
  pin: string | null;
  /** Masked-name gate: the holder's name and the positions the viewer must fill in. */
  name: { full: string; hidden: number[] } | null;
};

export type ViewerState = { peerId: string; joinedAt: number; online: boolean; verified: boolean };

/** Persisted (plugin kv, on this device only). `secret` is wiped when the share ends. */
export type ShareRecord = {
  id: string;
  createdAt: number;
  expiresAt: number;
  status: 'active' | 'ended';
  endReason?: EndReason;
  endedAt?: number;
  /** Set when "reset viewer" replaced this share with a new channel. */
  replacedBy?: string;
  capYuan: number | null;
  /** Masked hint shown to the viewer, if the name gate is on. */
  nameHint?: string;
  pin: boolean;
  secret?: { pin: string | null; name: { full: string; hidden: number[] } | null };
  viewer: ViewerState | null;
  viewersSeen: number;
  failures: number;
  codesIssued: number;
  lastCodeAt?: number;
  spent: number;
  payments: SharePayment[];
  /** The phone couldn't mint (card service down, not 数字卡); cleared by the next code. */
  paused?: string;
  source: CodeSource['kind'];
};

/** Texts for the ongoing (foreground service) notification. */
export type OngoingText = {
  title: string;
  stop: string;
  body(r: ShareRecord, now: number): string;
};

export type SessionDeps = {
  cloud: PluginCloud;
  source: CodeSource;
  clock?: Clock;
  /** Save the record (called after every change). */
  persist(record: ShareRecord): Promise<void> | void;
  ongoing?: HostServices['ongoing'];
  ongoingText?: OngoingText;
  refreshMs?: number;
};

export function shareMetaOf(config: ShareConfig): ShareMeta {
  return {
    v: FRAME_VERSION,
    kind: 'card-share',
    ...(config.name ? { nameHint: maskName(config.name.full, config.name.hidden) } : {}),
    pin: config.pin != null,
    capYuan: config.capYuan,
  };
}

const CLOSE_TO_END: Record<ChannelCloseReason, EndReason> = { owner: 'owner', expired: 'expired', revoked: 'revoked', locked: 'locked', server: 'server' };

type Kickable = Channel & { kick?: (peerId: string) => Promise<void> };

export class ShareSession {
  readonly record: ShareRecord;
  private readonly clock: Clock;
  private readonly refreshMs: number;
  private codeTimer: unknown = null;
  private expiryTimer: unknown = null;
  private pollTimer: unknown = null;
  private capTimers = new Set<unknown>();
  private unsubs: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private minting = false;
  private checking = false;
  private seq = 0;
  private lastFrame: { frame: Extract<OwnerFrame, { t: 'code' }>; at: number } | null = null;
  private ongoing: OngoingHandle | null = null;

  private constructor(
    readonly channel: Channel,
    record: ShareRecord,
    private readonly deps: SessionDeps,
  ) {
    this.record = record;
    this.clock = deps.clock ?? realClock;
    this.refreshMs = deps.refreshMs ?? CODE_REFRESH_MS;
  }

  /** Open a channel and start sharing. */
  static async start(deps: SessionDeps, config: ShareConfig): Promise<ShareSession> {
    const clock = deps.clock ?? realClock;
    const meta = shareMetaOf(config);
    const channel = await deps.cloud.channels.open({ ttlS: config.ttlS, maxPeers: 1, page: 'view', meta });
    const record: ShareRecord = {
      id: channel.id,
      createdAt: clock.now(),
      expiresAt: channel.expiresAt,
      status: 'active',
      capYuan: config.capYuan,
      ...(meta.nameHint ? { nameHint: meta.nameHint } : {}),
      pin: meta.pin,
      secret: { pin: config.pin, name: config.name },
      viewer: null,
      viewersSeen: 0,
      failures: 0,
      codesIssued: 0,
      spent: 0,
      payments: [],
      source: deps.source.kind,
    };
    const s = new ShareSession(channel, record, deps);
    await s.attach();
    return s;
  }

  /** Re-attach a persisted active share to its channel (after an app restart). */
  static async resume(deps: SessionDeps, channel: Channel, record: ShareRecord): Promise<ShareSession> {
    const s = new ShareSession(channel, record, deps);
    s.record.expiresAt = channel.expiresAt;
    if (s.record.viewer) s.record.viewer.online = channel.peers().some((p) => p.id === s.record.viewer!.peerId);
    await s.attach();
    return s;
  }

  get id() {
    return this.record.id;
  }
  get active() {
    return this.record.status === 'active';
  }
  get link() {
    return this.channel.link;
  }
  /** Gates the viewer still has to pass. */
  get need(): GateKind[] {
    return gatesOf({ nameHint: this.record.nameHint, pin: this.record.pin });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────

  private async attach() {
    this.unsubs.push(
      this.channel.on('join', (e) => void this.onJoin(e)),
      this.channel.on('leave', (e) => this.onLeave(e)),
      this.channel.on('message', (e) => void this.onMessage(e)),
      this.channel.on('closed', (e) => {
        if (e.type === 'closed') void this.end(CLOSE_TO_END[e.reason] ?? 'server', { remote: true });
      }),
    );
    this.armExpiry();
    this.armPoll();
    this.startOngoing();
    await this.changed();
    if (this.clock.now() >= this.record.expiresAt) await this.end('expired');
    else if (this.record.viewer?.online && this.record.viewer.verified) void this.pushCode();
  }

  private armExpiry() {
    if (this.expiryTimer) this.clock.clearTimeout(this.expiryTimer);
    this.expiryTimer = this.clock.setTimeout(() => void this.end('expired'), Math.max(0, this.record.expiresAt - this.clock.now()));
  }

  private armPoll() {
    if (this.pollTimer) this.clock.clearTimeout(this.pollTimer);
    this.pollTimer = this.clock.setTimeout(() => {
      this.pollTimer = null;
      if (!this.active) return;
      void this.checkCap().finally(() => this.active && this.armPoll());
    }, CAP_POLL_MS);
  }

  private startOngoing() {
    const { ongoing, ongoingText } = this.deps;
    if (!ongoing || !ongoingText || !this.active) return;
    try {
      this.ongoing?.stop();
      this.ongoing = ongoing.start({
        title: ongoingText.title,
        body: ongoingText.body(this.record, this.clock.now()),
        until: this.record.expiresAt,
        stopLabel: ongoingText.stop,
        onStop: () => void this.end('owner'),
      });
    } catch {
      this.ongoing = null; // no foreground service on this build: the share still runs while the app is open
    }
  }

  private async changed() {
    if (this.ongoing && this.deps.ongoingText && this.active) {
      try {
        this.ongoing.update({ body: this.deps.ongoingText.body(this.record, this.clock.now()) });
      } catch {
        // ignore: notification gone
      }
    }
    for (const fn of this.listeners) fn();
    await this.deps.persist(this.record);
  }

  private async send(frame: OwnerFrame, to: string | '*' = this.record.viewer?.peerId ?? '*') {
    try {
      await this.channel.send(to, frame);
      return true;
    } catch {
      return false; // offline or the viewer left; the next event retries
    }
  }

  private statusFrame(): OwnerFrame {
    const v = this.record.viewer;
    const capped = this.record.capYuan != null && this.record.spent >= this.record.capYuan;
    return {
      t: 'status',
      state: capped ? 'capped' : v && !v.verified ? 'gate' : this.record.paused ? 'paused' : 'live',
      ...(v && !v.verified ? { need: this.need } : {}),
      expiresAt: this.record.expiresAt,
      spentYuan: this.record.spent,
      capYuan: this.record.capYuan,
      ...(this.record.paused ? { message: this.record.paused } : {}),
    };
  }

  // ── channel events ────────────────────────────────────────────────────────────────────────

  private async onJoin(e: ChannelEvent) {
    if (e.type !== 'join' || !this.active) return;
    const v = this.record.viewer;
    if (v && v.peerId === e.peerId) v.online = true;
    else {
      this.record.viewer = { peerId: e.peerId, joinedAt: e.at, online: true, verified: this.need.length === 0 };
      this.record.viewersSeen++;
    }
    await this.changed();
    await this.send(this.statusFrame(), e.peerId);
    if (this.record.viewer!.verified) await this.pushCode();
  }

  private onLeave(e: ChannelEvent) {
    if (e.type !== 'leave' || this.record.viewer?.peerId !== e.peerId) return;
    this.record.viewer.online = false;
    this.clearCodeTimer();
    void this.changed();
  }

  private async onMessage(e: ChannelEvent) {
    if (e.type !== 'message' || !this.active) return;
    const v = this.record.viewer;
    if (!v || v.peerId !== e.peerId) return; // not the viewer who claimed the share
    const frame = parseViewerFrame(e.msg);
    if (!frame) return;
    if (!v.online) v.online = true;
    if (frame.t === 'want') {
      if (!v.verified) await this.send(this.statusFrame());
      else await this.pushCode({ want: true });
      return;
    }
    // gate
    if (v.verified) {
      await this.send({ t: 'gate_result', ok: true });
      await this.pushCode({ want: true });
      return;
    }
    const wrong: GateKind[] = [];
    const secret = this.record.secret;
    if (this.record.nameHint && secret?.name && !(frame.name && checkName(frame.name, secret.name.full, secret.name.hidden))) wrong.push('name');
    if (this.record.pin && secret?.pin && !(frame.pin && checkPin(frame.pin, secret.pin))) wrong.push('pin');
    if (wrong.length === 0) {
      v.verified = true;
      await this.changed();
      await this.send({ t: 'gate_result', ok: true });
      await this.send(this.statusFrame());
      await this.pushCode();
      return;
    }
    this.record.failures++;
    const remaining = Math.max(0, MAX_GATE_FAILURES - this.record.failures);
    await this.changed();
    await this.send({ t: 'gate_result', ok: false, remaining, wrong });
    if (remaining === 0) await this.end('locked');
  }

  // ── codes ─────────────────────────────────────────────────────────────────────────────────

  private clearCodeTimer() {
    if (this.codeTimer) this.clock.clearTimeout(this.codeTimer);
    this.codeTimer = null;
  }

  private scheduleCode() {
    this.clearCodeTimer();
    if (!this.active) return;
    this.codeTimer = this.clock.setTimeout(() => {
      this.codeTimer = null;
      void this.pushCode();
    }, this.refreshMs);
  }

  private get capped() {
    return this.record.capYuan != null && this.record.spent >= this.record.capYuan;
  }

  /** Mint and send a code to the verified, connected viewer. */
  async pushCode(opts: { want?: boolean } = {}): Promise<void> {
    const v = this.record.viewer;
    if (!this.active || !v?.verified || !v.online || this.capped || this.minting) return;
    const now = this.clock.now();
    if (opts.want && this.lastFrame && now - this.lastFrame.at < WANT_MIN_GAP_MS) {
      await this.send(this.lastFrame.frame, v.peerId);
      return;
    }
    this.minting = true;
    try {
      const minted = await this.deps.source.mint();
      if (!this.active || this.record.viewer?.peerId !== v.peerId) return;
      const frame: Extract<OwnerFrame, { t: 'code' }> = {
        t: 'code',
        code: minted.code,
        issuedAt: this.clock.now(),
        seq: ++this.seq,
        balance: minted.balance,
        refreshS: Math.round(this.refreshMs / 1000),
      };
      this.lastFrame = { frame, at: frame.issuedAt };
      const wasPaused = this.record.paused;
      if (await this.send(frame, v.peerId)) {
        this.record.codesIssued++;
        this.record.lastCodeAt = frame.issuedAt;
        delete this.record.paused;
        for (const ms of CAP_CHECKS_AFTER_CODE_MS) this.armCapCheck(ms);
        if (wasPaused) await this.send(this.statusFrame(), v.peerId);
        await this.changed();
      }
    } catch (e) {
      this.record.paused = e instanceof NotDigitalError ? e.message : '分享者暂时无法获取付款码';
      await this.changed();
      await this.send(this.statusFrame(), v.peerId);
    } finally {
      this.minting = false;
      if (this.active && this.record.viewer?.online && this.record.viewer.verified) this.scheduleCode();
    }
  }

  // ── spend cap ─────────────────────────────────────────────────────────────────────────────

  private armCapCheck(ms: number) {
    const h = this.clock.setTimeout(() => {
      this.capTimers.delete(h);
      void this.checkCap();
    }, ms);
    this.capTimers.add(h);
  }

  /** Read turnover, update spend, and close the share when the cap is reached. */
  async checkCap(opts: { final?: boolean } = {}): Promise<void> {
    if ((!this.active && !opts.final) || this.checking) return;
    this.checking = true;
    try {
      const records = await this.deps.source.turnover(this.record.createdAt);
      const st = evaluateCap(records, this.record.createdAt, this.record.capYuan, this.record.payments);
      const grew = st.payments.length !== this.record.payments.length;
      this.record.spent = st.spent;
      this.record.payments = st.payments;
      if (grew) await this.changed();
      if (st.reached && this.active) {
        await this.send(this.statusFrame());
        await this.end('cap');
      }
    } catch {
      // card service unreachable: try again at the next check
    } finally {
      this.checking = false;
    }
  }

  // ── owner actions ─────────────────────────────────────────────────────────────────────────

  async extend(ttlS: number): Promise<void> {
    if (!this.active) return;
    await this.channel.extend(ttlS);
    this.record.expiresAt = Math.max(this.channel.expiresAt, this.clock.now() + ttlS * 1000);
    this.armExpiry();
    this.startOngoing();
    await this.changed();
    if (this.record.viewer?.online) await this.send(this.statusFrame());
  }

  /** Whether the channel can drop its viewer in place (else "reset" means a new link). */
  get canKick(): boolean {
    return typeof (this.channel as Kickable).kick === 'function';
  }

  /** Drop the current viewer so someone else can open the same link. Needs `canKick`. */
  async kickViewer(): Promise<void> {
    const v = this.record.viewer;
    const kick = (this.channel as Kickable).kick;
    if (!v || !kick) return;
    await this.send({ t: 'revoked', reason: 'revoked' }, v.peerId);
    await kick.call(this.channel, v.peerId);
    this.record.viewer = null;
    this.clearCodeTimer();
    this.lastFrame = null;
    await this.changed();
  }

  /** Stop sharing. `remote`: the relay already closed the channel. */
  async end(reason: EndReason, opts: { remote?: boolean; replacedBy?: string } = {}): Promise<void> {
    if (!this.active) return;
    this.record.status = 'ended';
    this.record.endReason = reason;
    this.record.endedAt = this.clock.now();
    if (opts.replacedBy) this.record.replacedBy = opts.replacedBy;
    delete this.record.secret;
    delete this.record.paused;
    if (this.record.viewer) this.record.viewer.online = false;
    this.clearCodeTimer();
    for (const h of [this.expiryTimer, this.pollTimer, ...this.capTimers]) if (h) this.clock.clearTimeout(h);
    this.capTimers.clear();
    this.expiryTimer = this.pollTimer = null;
    this.lastFrame = null;
    try {
      this.ongoing?.stop();
    } catch {
      // already gone
    }
    this.ongoing = null;
    if (!opts.remote) {
      await this.send({ t: 'revoked', reason }, '*');
      try {
        await this.channel.close();
      } catch {
        // the relay expires it anyway
      }
    }
    for (const u of this.unsubs.splice(0)) u();
    await this.changed();
    // Payments made with the last codes show up in turnover a little later.
    if (this.record.codesIssued > 0) void this.checkCap({ final: true });
  }
}
