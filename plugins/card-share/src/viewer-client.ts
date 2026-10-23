/**
 * The viewer side of a share: reads the sealed meta, claims the channel, answers the gates and
 * receives codes. Shared by the in-app viewer (screens/view.tsx, React Native) and the web
 * viewer (web/, WeChat webview included), so it uses only `fetch`, `WebSocket` / `EventSource`
 * (passed in) and the pure-JS crypto in `@pku-harness/cloud-protocol` (no WebCrypto).
 *
 * Wire: docs/CLOUD.md §2.3 (`GET /v1/c/:id`, `POST /v1/c/:id/join`, peer WebSocket, or SSE +
 * `POST /v1/c/:id/send` when WebSocket is missing or blocked).
 */
import {
  channelInfoResponse,
  deriveShareKeys,
  envelopeSchema,
  errorBody,
  fromB64url,
  generateBoxKeyPair,
  joinResponse,
  open,
  paths,
  peerInFrame,
  seal,
  toB64url,
  viewerPeerKey,
  type Envelope,
  type PeerInFrame,
  type RandomBytes,
} from '@pku-harness/cloud-protocol';

import { gatesOf, parseMeta, parseOwnerFrame, type EndReason, type GateKind, type OwnerFrame, type ShareMeta, type ViewerFrame } from './protocol';

export type ViewerState =
  | { s: 'loading' }
  | { s: 'gate'; meta: ShareMeta; need: GateKind[]; busy: boolean; remaining?: number; wrong?: GateKind[] }
  | { s: 'waiting'; meta: ShareMeta; ownerOnline: boolean }
  | { s: 'live'; meta: ShareMeta; code: string; issuedAt: number; /** Local clock when it arrived (countdowns use this, not the sharer's clock). */ receivedAt: number; seq: number; balance: number | null; refreshS: number; ownerOnline: boolean }
  | { s: 'paused'; meta: ShareMeta; message?: string; ownerOnline: boolean }
  | { s: 'capped'; meta: ShareMeta }
  | { s: 'ended'; reason: EndReason | 'kicked' }
  | { s: 'expired' }
  | { s: 'taken' }
  | { s: 'error'; message: string };

/** Small persistent store (localStorage on the web, the plugin kv in the app). */
export interface ViewerStore {
  get(key: string): Promise<string | null | undefined> | string | null | undefined;
  set(key: string, value: string): Promise<void> | void;
  delete(key: string): Promise<void> | void;
}

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};
type EventSourceLike = { close(): void; onmessage: ((ev: { data: unknown }) => void) | null; onerror: ((ev: unknown) => void) | null; onopen?: ((ev: unknown) => void) | null };

export type ViewerOptions = {
  /** Provider base URL (`https://s.example.org`), from the link or the app's cloud settings. */
  base: string;
  channelId: string;
  /** The link secret from `#k=`. */
  k: Uint8Array;
  fetch: typeof fetch;
  WebSocket?: new (url: string) => WebSocketLike;
  EventSource?: new (url: string) => EventSourceLike;
  store?: ViewerStore;
  rand?: RandomBytes;
  now?: () => number;
  onState(state: ViewerState): void;
};

/**
 * Associated data for meta and frames. The share's channel id binds envelopes to this channel;
 * plain (no aad) is accepted too, and whichever opens the meta is used for frames as well.
 */
const aadCandidates = (channelId: string): (string | undefined)[] => [undefined, channelId];

type Saved = { peerId: string; token: string; priv: string; pub: string; verified: boolean };

const WS_OPEN = 1;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
const PING_MS = 25_000;
/** Ask for a new code when the shown one is older than its refresh period plus this. */
const STALE_GRACE_MS = 8_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export class ShareViewer {
  private state: ViewerState = { s: 'loading' };
  private meta: ShareMeta | null = null;
  private chanPub: Uint8Array | null = null;
  private encKey: Uint8Array;
  private authKey: Uint8Array;
  private aad: string | undefined;
  private peerKey: Uint8Array | null = null;
  private saved: Saved | null = null;
  private expiresAt = 0;
  private ownerOnline = false;
  private verified = false;
  private ws: WebSocketLike | null = null;
  private sse: EventSourceLike | null = null;
  private useSse = false;
  private connected = false;
  private queue: ViewerFrame[] = [];
  private attempt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private pendingGate: { pin?: string; name?: string } | null = null;

  constructor(private readonly o: ViewerOptions) {
    const keys = deriveShareKeys(o.k);
    this.encKey = keys.encKey;
    this.authKey = keys.authKey;
  }

  get current(): ViewerState {
    return this.state;
  }

  /** When the share ends (ms epoch; 0 before the first read). */
  get expires(): number {
    return this.expiresAt;
  }

  private get storeKey() {
    return `card-share.viewer.${this.o.channelId}`;
  }
  private now() {
    return this.o.now?.() ?? Date.now();
  }
  private set(state: ViewerState) {
    this.state = state;
    if (!this.stopped || state.s === 'ended' || state.s === 'expired') this.o.onState(state);
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────────────────────

  private async http(path: string, init?: { method?: string; body?: unknown; token?: string }): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (init?.body !== undefined) headers['content-type'] = 'application/json';
    if (init?.token) headers.authorization = `Bearer ${init.token}`;
    const res = await this.o.fetch(this.o.base + path, { method: init?.method ?? 'GET', headers, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // not JSON
    }
    if (!res.ok) {
      const err = errorBody.safeParse(json);
      throw new HttpError(res.status, err.success ? err.data.error.code : undefined, err.success ? err.data.error.message : `HTTP ${res.status}`);
    }
    return json;
  }

  // ── start ──────────────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.stopped = false;
    this.set({ s: 'loading' });
    let info;
    try {
      info = channelInfoResponse.parse(await this.http(paths.publicChannel(this.o.channelId)));
    } catch (e) {
      if (e instanceof HttpError && (e.status === 404 || e.status === 410)) return this.set({ s: 'ended', reason: 'revoked' });
      return this.set({ s: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    if (info.status === 'expired') return this.set({ s: 'expired' });
    if (info.status === 'closed') return this.set({ s: 'ended', reason: 'revoked' });
    this.expiresAt = info.expiresAt;
    this.ownerOnline = info.ownerOnline;
    this.chanPub = fromB64url(info.chanPub);
    const meta = this.openMeta(info.meta);
    if (!meta) return this.set({ s: 'error', message: 'bad_link' });
    this.meta = meta;

    const raw = await this.o.store?.get(this.storeKey);
    if (raw) {
      try {
        this.saved = JSON.parse(raw) as Saved;
        this.verified = this.saved.verified;
        this.peerKey = viewerPeerKey(fromB64url(this.saved.priv), fromB64url(this.saved.pub), this.chanPub, this.encKey);
        this.set(this.verified ? { s: 'waiting', meta, ownerOnline: this.ownerOnline } : this.gateState(false));
        this.connect();
        return;
      } catch {
        this.saved = null;
      }
    }
    const need = gatesOf(meta);
    if (need.length) return this.set(this.gateState(false));
    await this.join();
  }

  private openMeta(env: Envelope): ShareMeta | undefined {
    for (const aad of aadCandidates(this.o.channelId)) {
      try {
        const meta = parseMeta(open(this.encKey, env, aad === undefined ? undefined : { aad }));
        if (meta) {
          this.aad = aad;
          return meta;
        }
      } catch {
        // try the next convention
      }
    }
    return undefined;
  }

  private gateState(busy: boolean, extra?: { remaining?: number; wrong?: GateKind[] }): ViewerState {
    return { s: 'gate', meta: this.meta!, need: gatesOf(this.meta!), busy, ...extra };
  }

  private async join(): Promise<boolean> {
    const kp = generateBoxKeyPair(this.o.rand);
    try {
      const r = joinResponse.parse(await this.http(paths.join(this.o.channelId), { method: 'POST', body: { authKey: toB64url(this.authKey), peerPub: toB64url(kp.publicKey) } }));
      this.saved = { peerId: r.peerId, token: r.peerToken, priv: toB64url(kp.secretKey), pub: toB64url(kp.publicKey), verified: gatesOf(this.meta!).length === 0 };
      this.verified = this.saved.verified;
      this.peerKey = viewerPeerKey(kp.secretKey, kp.publicKey, this.chanPub!, this.encKey);
      await this.persist();
      if (this.verified) this.set({ s: 'waiting', meta: this.meta!, ownerOnline: this.ownerOnline });
      this.connect();
      return true;
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 409 || e.code === 'conflict') this.set({ s: 'taken' });
        else if (e.status === 410 || e.code === 'gone') this.set({ s: 'expired' });
        else if (e.status === 403 || e.code === 'forbidden') this.set({ s: 'error', message: 'bad_link' });
        else this.set({ s: 'error', message: e.message });
      } else this.set({ s: 'error', message: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  private async persist() {
    if (this.saved) await this.o.store?.set(this.storeKey, JSON.stringify(this.saved));
  }

  private async forget() {
    this.saved = null;
    await this.o.store?.delete(this.storeKey);
  }

  // ── actions ────────────────────────────────────────────────────────────────────────────────

  /** Send gate answers (joins first if needed). */
  async submitGate(answers: { pin?: string; name?: string }): Promise<void> {
    if (!this.meta || this.state.s === 'taken' || this.state.s === 'ended' || this.state.s === 'expired') return;
    this.set(this.gateState(true));
    if (!this.saved) {
      this.pendingGate = answers;
      if (!(await this.join())) return;
      return; // sent on hello
    }
    this.sendFrame({ t: 'gate', ...answers });
  }

  /** Ask for a fresh code (page back in view, cashier waiting). */
  want() {
    if (this.verified && this.saved) this.sendFrame({ t: 'want' });
  }

  /** Disconnect (component unmount). The claim and keys stay saved for a reload. */
  stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.pingTimer = this.staleTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.sse?.close();
    this.sse = null;
    this.connected = false;
  }

  // ── transport ──────────────────────────────────────────────────────────────────────────────

  private connect() {
    if (this.stopped || !this.saved) return;
    if (!this.staleTimer) this.staleTimer = setInterval(() => this.tick(), 4000);
    if (!this.useSse && this.o.WebSocket) this.connectWs();
    else if (this.o.EventSource) this.connectSse();
    else this.set({ s: 'error', message: 'no_transport' });
  }

  private connectWs() {
    const url = this.o.base.replace(/^http/i, 'ws') + paths.peerWs(this.o.channelId, this.saved!.token);
    let opened = false;
    let ws: WebSocketLike;
    try {
      ws = new this.o.WebSocket!(url);
    } catch {
      this.useSse = true;
      return this.connect();
    }
    this.ws = ws;
    // Some webviews hang on a blocked upgrade instead of failing: fall back after 6 s.
    const guard = setTimeout(() => {
      if (!opened && this.ws === ws) {
        ws.onclose = null;
        ws.close();
        this.ws = null;
        if (this.o.EventSource) this.useSse = true;
        this.connect();
      }
    }, 6000);
    this.timers.push(guard);
    ws.onopen = () => {
      opened = true;
      clearTimeout(guard);
      this.attempt = 0;
      this.onConnected();
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WS_OPEN) this.ws.send(JSON.stringify({ t: 'ping' }));
      }, PING_MS);
    };
    ws.onmessage = (ev) => this.onRaw(ev.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(guard);
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (!opened && this.o.EventSource) this.useSse = true;
      this.reconnect();
    };
  }

  private connectSse() {
    const es = new this.o.EventSource!(this.o.base + paths.peerEvents(this.o.channelId, this.saved!.token));
    this.sse = es;
    es.onmessage = (ev) => {
      if (!this.connected) this.onConnected();
      this.onRaw(ev.data);
    };
    if ('onopen' in es) es.onopen = () => this.onConnected();
    es.onerror = () => {
      // EventSource reconnects by itself; a hard failure closes it.
      this.connected = false;
    };
  }

  private reconnect() {
    if (this.stopped || this.isTerminal()) return;
    const ms = BACKOFF_MS[Math.min(this.attempt++, BACKOFF_MS.length - 1)]!;
    this.timers.push(setTimeout(() => this.connect(), ms));
  }

  private isTerminal() {
    return ['ended', 'expired', 'taken'].includes(this.state.s);
  }

  private onConnected() {
    if (this.connected) return;
    this.connected = true;
    if (this.pendingGate) {
      const g = this.pendingGate;
      this.pendingGate = null;
      this.queue.unshift({ t: 'gate', ...g });
    }
    const q = this.queue.splice(0);
    for (const f of q) this.sendFrame(f);
    if (this.verified) this.sendFrame({ t: 'want' });
  }

  private sendFrame(frame: ViewerFrame) {
    if (!this.peerKey || !this.saved) return;
    if (!this.connected) {
      this.queue.push(frame);
      return;
    }
    const env = seal(this.peerKey, frame, { aad: this.aad, rand: this.o.rand });
    const out = { t: 'msg', env };
    if (this.ws && this.ws.readyState === WS_OPEN) this.ws.send(JSON.stringify(out));
    else if (this.sse)
      void this.http(`${paths.peerSend(this.o.channelId)}?t=${encodeURIComponent(this.saved.token)}`, { method: 'POST', body: out, token: this.saved.token }).catch(() => {
        this.queue.push(frame);
      });
    else this.queue.push(frame);
  }

  private onRaw(data: unknown) {
    if (typeof data !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const f = peerInFrame.safeParse(json);
    if (f.success) void this.onFrame(f.data);
  }

  private async onFrame(f: PeerInFrame) {
    switch (f.t) {
      case 'hello':
        this.ownerOnline = f.ownerOnline;
        this.expiresAt = f.expiresAt;
        this.refreshOwner();
        return;
      case 'owner':
        this.ownerOnline = f.online;
        this.refreshOwner();
        if (f.online) this.want();
        return;
      case 'extended':
        this.expiresAt = f.expiresAt;
        return;
      case 'closed':
        await this.finish(f.reason === 'kicked' ? { s: 'ended', reason: 'kicked' } : f.reason === 'expired' ? { s: 'expired' } : { s: 'ended', reason: f.reason === 'owner' ? 'owner' : f.reason });
        return;
      case 'error':
        if (f.code === 'unauthorized' || f.code === 'gone' || f.code === 'not_found') {
          await this.forget();
          await this.finish(f.code === 'gone' ? { s: 'expired' } : { s: 'ended', reason: 'revoked' });
        }
        return;
      case 'msg': {
        const env = envelopeSchema.safeParse(f.env);
        if (!env.success || !this.peerKey) return;
        let msg: unknown;
        try {
          msg = open(this.peerKey, env.data, { aad: this.aad });
        } catch {
          return; // not for us / tampered
        }
        const frame = parseOwnerFrame(msg);
        if (frame) await this.onOwnerFrame(frame);
        return;
      }
      default:
        return;
    }
  }

  private refreshOwner() {
    const st = this.state;
    if (st.s === 'waiting' || st.s === 'live' || st.s === 'paused') this.set({ ...st, ownerOnline: this.ownerOnline });
  }

  private async markVerified() {
    if (this.verified) return;
    this.verified = true;
    if (this.saved) {
      this.saved.verified = true;
      await this.persist();
    }
  }

  private async onOwnerFrame(f: OwnerFrame) {
    const meta = this.meta!;
    switch (f.t) {
      case 'code':
        await this.markVerified();
        this.set({ s: 'live', meta, code: f.code, issuedAt: f.issuedAt, receivedAt: this.now(), seq: f.seq, balance: f.balance ?? null, refreshS: f.refreshS ?? 25, ownerOnline: true });
        return;
      case 'gate_result':
        if (f.ok) {
          await this.markVerified();
          if (this.state.s !== 'live') this.set({ s: 'waiting', meta, ownerOnline: this.ownerOnline });
        } else this.set(this.gateState(false, { remaining: f.remaining, wrong: f.wrong }));
        return;
      case 'status':
        this.expiresAt = f.expiresAt;
        if (f.state === 'gate') {
          if (this.state.s !== 'gate') this.set(this.gateState(false));
        } else if (f.state === 'capped') this.set({ s: 'capped', meta });
        else if (f.state === 'paused') this.set({ s: 'paused', meta, message: f.message, ownerOnline: this.ownerOnline });
        else if (this.state.s !== 'live') this.set({ s: 'waiting', meta, ownerOnline: this.ownerOnline });
        return;
      case 'revoked':
        await this.finish(f.reason === 'expired' ? { s: 'expired' } : f.reason === 'cap' ? { s: 'capped', meta } : { s: 'ended', reason: f.reason });
        return;
    }
  }

  private async finish(state: ViewerState) {
    await this.forget();
    this.set(state);
    this.stop();
  }

  private tick() {
    if (this.stopped) return;
    const now = this.now();
    if (this.expiresAt && now > this.expiresAt + 5000 && !this.isTerminal()) {
      void this.finish({ s: 'expired' });
      return;
    }
    const st = this.state;
    if (st.s === 'live' && now - st.receivedAt > st.refreshS * 1000 + STALE_GRACE_MS) this.want();
  }
}
