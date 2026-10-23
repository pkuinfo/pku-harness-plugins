/** Test doubles: a fake clock, an in-memory channel/cloud and kv. No network. */
import type { Channel, ChannelEvent, ChannelEventType, KV, PluginCloud, SecretLink } from '@pku-harness/sdk';

import type { Clock } from '../session';

export const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

export class FakeClock implements Clock {
  t: number;
  private seq = 0;
  timers: { id: number; at: number; fn: () => void }[] = [];
  constructor(start = Date.UTC(2026, 9, 23, 4, 0, 0)) {
    this.t = start;
  }
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  /** Advance time, firing due timers in order and letting their promises settle. */
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

export class FakeChannel implements Channel {
  link: SecretLink;
  sent: { to: string; msg: any }[] = [];
  closed = false;
  offline = false;
  kicked: string[] = [];
  private handlers = new Map<ChannelEventType, Set<(e: ChannelEvent) => void>>();
  private online = new Map<string, number>();
  mailbox = { put: async () => {}, clear: async () => {} };
  constructor(
    public id: string,
    public expiresAt: number,
    private clock: FakeClock,
    readonly opts: { ttlS: number; maxPeers?: number; page?: string; meta?: unknown },
  ) {
    this.link = { kind: 'secret-link', channelId: id, toJSON: () => '[secret link]' };
  }
  peers() {
    return [...this.online].map(([id, joinedAt]) => ({ id, joinedAt }));
  }
  on(ev: ChannelEventType, fn: (e: ChannelEvent) => void) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
    return () => void this.handlers.get(ev)!.delete(fn);
  }
  async send(to: string, msg: unknown) {
    if (this.closed || this.offline) throw new Error('offline');
    this.sent.push({ to, msg: JSON.parse(JSON.stringify(msg)) });
  }
  async extend(ttlS: number) {
    this.expiresAt = this.clock.now() + ttlS * 1000;
  }
  async close() {
    this.closed = true;
  }
  emit(e: ChannelEvent) {
    if (e.type === 'join') this.online.set(e.peerId, e.at);
    if (e.type === 'leave') this.online.delete(e.peerId);
    for (const fn of this.handlers.get(e.type) ?? []) fn(e);
  }
  join(peerId = 'peer-1') {
    this.emit({ type: 'join', peerId, at: this.clock.now() });
  }
  say(msg: unknown, peerId = 'peer-1') {
    this.emit({ type: 'message', peerId, msg });
  }
  /** Frames sent to a peer, of one type. */
  framesOf(t: string, to?: string) {
    return this.sent.filter((x) => x.msg.t === t && (to === undefined || x.to === to)).map((x) => x.msg);
  }
}

export class FakeKickChannel extends FakeChannel {
  async kick(peerId: string) {
    this.kicked.push(peerId);
    this.emit({ type: 'leave', peerId, at: Date.now() });
  }
}

export function fakeCloud(clock: FakeClock, opts: { kick?: boolean } = {}) {
  const channels: FakeChannel[] = [];
  let n = 0;
  const cloud: PluginCloud = {
    available: true,
    status: () => ({ provider: 'custom', baseURL: 'http://relay.test', consented: true, online: true }),
    store: { get: async () => undefined, put: async () => ({ version: 1 }), delete: async () => {}, list: async () => [] },
    channels: {
      open: async (o) => {
        const C = opts.kick ? FakeKickChannel : FakeChannel;
        const ch = new C(`chan${String(++n).padStart(6, '0')}`, clock.now() + o.ttlS * 1000, clock, o);
        channels.push(ch);
        return ch;
      },
      get: (id) => channels.find((c) => c.id === id && !c.closed),
      list: () => channels.filter((c) => !c.closed),
    },
    push: { schedule: async () => 'x', cancel: async () => {} },
    functions: { invoke: async () => undefined },
  };
  return { cloud, channels };
}

export function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(k: string) => (data.has(k) ? (JSON.parse(JSON.stringify(data.get(k))) as T) : undefined),
    set: async (k, v) => void data.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void data.delete(k),
  };
}
