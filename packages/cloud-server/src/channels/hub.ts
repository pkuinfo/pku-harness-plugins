/**
 * In-memory registry of live channel connections (one owner socket per channel, one socket or
 * SSE stream per claimed peer) and the GC loop (pkubdcard `share.gcLoop`, generalised).
 *
 * The hub only routes envelopes: frames are parsed to find the recipient, size- and
 * rate-checked, and forwarded. Nothing about a frame is persisted or logged.
 */
import {
  type Envelope,
  type OwnerInFrame,
  type PeerInFrame,
  type PeerOutFrame,
  type WireErrorCode,
  ownerOutFrame,
  peerOutFrame,
} from '@pku-harness/cloud-protocol';

import type { Config } from '../config';
import type { ChannelRow, PeerRow, Storage } from '../db/storage';
import type { RateLimiter } from '../limits';
import type { Logger } from '../log';

/** A live connection: a WebSocket, or an SSE stream (peers only). */
export interface Conn {
  send(data: string): void;
  close(code: number, reason: string): void;
}

/** WebSocket close codes used by the server. */
export const CLOSE = { replaced: 4009, kicked: 4003, closed: 4010, goingAway: 1001 } as const;

export type CloseReason = 'owner' | 'expired' | 'revoked' | 'locked' | 'server';

/** Envelope ciphertext is capped at `frameBytes` (base64url length ≈ 4/3 of the bytes). */
export function envelopeTooLarge(env: Envelope, frameBytes: number): boolean {
  return env.c.length > Math.ceil((frameBytes * 4) / 3) + 4;
}

type Result = { ok: true } | { ok: false; code: WireErrorCode; message: string };

export class Hub {
  private owners = new Map<string, Conn>();
  private peers = new Map<string, Map<string, Conn>>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly storage: Storage,
    private readonly config: Config,
    private readonly limiter: RateLimiter,
    private readonly log: Logger,
    private readonly now: () => number,
  ) {}

  // --- presence ------------------------------------------------------------------------

  ownerOnline(channelId: string): boolean {
    return this.owners.has(channelId);
  }

  peerOnline(channelId: string, peerId: string): boolean {
    return this.peers.get(channelId)?.has(peerId) ?? false;
  }

  private toOwner(channelId: string, frame: OwnerInFrame): boolean {
    const c = this.owners.get(channelId);
    if (!c) return false;
    c.send(JSON.stringify(frame));
    return true;
  }

  private toPeer(channelId: string, peerId: string, frame: PeerInFrame): boolean {
    const c = this.peers.get(channelId)?.get(peerId);
    if (!c) return false;
    c.send(JSON.stringify(frame));
    return true;
  }

  private toPeers(channelId: string, frame: PeerInFrame) {
    const text = JSON.stringify(frame);
    for (const c of this.peers.get(channelId)?.values() ?? []) c.send(text);
  }

  // --- owner ---------------------------------------------------------------------------

  async attachOwner(ch: ChannelRow, conn: Conn): Promise<void> {
    const old = this.owners.get(ch.id);
    this.owners.set(ch.id, conn);
    if (old && old !== conn) old.close(CLOSE.replaced, 'replaced by a newer connection');
    const peers = await this.storage.listPeers(ch.id);
    conn.send(
      JSON.stringify({
        t: 'hello',
        id: ch.id,
        expiresAt: ch.expiresAt,
        peers: peers.map((p) => ({ peerId: p.peerId, peerPub: p.peerPub, joinedAt: p.joinedAt, online: this.peerOnline(ch.id, p.peerId) })),
      } satisfies OwnerInFrame),
    );
    if (!old) this.toPeers(ch.id, { t: 'owner', online: true });
  }

  detachOwner(channelId: string, conn: Conn) {
    if (this.owners.get(channelId) !== conn) return;
    this.owners.delete(channelId);
    this.toPeers(channelId, { t: 'owner', online: false });
  }

  /** A raw WebSocket message from the owner. */
  async ownerMessage(channelId: string, maxPeers: number, conn: Conn, raw: string | Buffer): Promise<void> {
    const err = (code: WireErrorCode, message: string) => conn.send(JSON.stringify({ t: 'error', code, message } satisfies OwnerInFrame));
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    if (Buffer.byteLength(text) > 2 * this.config.limits.channels.frameBytes) return err('payload_too_large', 'frame too large');
    const rate = { limit: this.config.limits.channels.framesPerMin * Math.max(1, maxPeers), windowS: 60 };
    const t = this.limiter.take(`frame:o:${channelId}`, rate);
    if (!t.ok) return err('rate_limited', 'too many frames');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return err('bad_request', 'frame must be JSON');
    }
    const f = ownerOutFrame.safeParse(json);
    if (!f.success) return err('bad_request', 'unknown or malformed frame');
    const frame = f.data;
    if (frame.t === 'ping') {
      conn.send(JSON.stringify({ t: 'pong', at: this.now() } satisfies OwnerInFrame));
      return;
    }
    if (frame.t === 'kick') {
      if (!(await this.kick(channelId, frame.peerId))) err('not_found', 'no such peer');
      return;
    }
    if (envelopeTooLarge(frame.env, this.config.limits.channels.frameBytes)) return err('payload_too_large', 'envelope too large');
    if (!(await this.storage.getPeer(channelId, frame.to))) return err('not_found', 'no such peer');
    if (!this.toPeer(channelId, frame.to, { t: 'msg', env: frame.env })) err('conflict', 'peer offline; frame dropped');
  }

  // --- peers ---------------------------------------------------------------------------

  async attachPeer(ch: ChannelRow, peerId: string, conn: Conn): Promise<void> {
    let map = this.peers.get(ch.id);
    if (!map) this.peers.set(ch.id, (map = new Map()));
    const old = map.get(peerId);
    map.set(peerId, conn);
    if (old && old !== conn) old.close(CLOSE.replaced, 'replaced by a newer connection');
    conn.send(JSON.stringify({ t: 'hello', peerId, ownerOnline: this.ownerOnline(ch.id), expiresAt: ch.expiresAt } satisfies PeerInFrame));
    if (!old) this.toOwner(ch.id, { t: 'peer', peerId, online: true, at: this.now() });
  }

  detachPeer(channelId: string, peerId: string, conn: Conn) {
    const map = this.peers.get(channelId);
    if (map?.get(peerId) !== conn) return;
    map.delete(peerId);
    if (map.size === 0) this.peers.delete(channelId);
    this.toOwner(channelId, { t: 'peer', peerId, online: false, at: this.now() });
  }

  /** A raw WebSocket message from a peer. */
  async peerMessage(channelId: string, peerId: string, conn: Conn, raw: string | Buffer): Promise<void> {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    let r: Result;
    if (Buffer.byteLength(text) > 2 * this.config.limits.channels.frameBytes) r = { ok: false, code: 'payload_too_large', message: 'frame too large' };
    else {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      const f = peerOutFrame.safeParse(json);
      r = f.success ? await this.peerFrame(channelId, peerId, f.data, conn) : { ok: false, code: 'bad_request', message: 'unknown or malformed frame' };
    }
    if (!r.ok) conn.send(JSON.stringify({ t: 'error', code: r.code, message: r.message } satisfies PeerInFrame));
  }

  /** A parsed peer frame (WebSocket, or `POST /v1/c/:id/send`). `reply` gets the pong. */
  async peerFrame(channelId: string, peerId: string, frame: PeerOutFrame, reply?: Conn): Promise<Result> {
    const t = this.limiter.take(`frame:p:${channelId}:${peerId}`, { limit: this.config.limits.channels.framesPerMin, windowS: 60 });
    if (!t.ok) return { ok: false, code: 'rate_limited', message: 'too many frames' };
    if (frame.t === 'ping') {
      const pong = JSON.stringify({ t: 'pong', at: this.now() } satisfies PeerInFrame);
      if (reply) reply.send(pong);
      else this.peers.get(channelId)?.get(peerId)?.send(pong);
      return { ok: true };
    }
    if (envelopeTooLarge(frame.env, this.config.limits.channels.frameBytes)) return { ok: false, code: 'payload_too_large', message: 'envelope too large' };
    if (!this.toOwner(channelId, { t: 'msg', peerId, env: frame.env })) return { ok: false, code: 'conflict', message: 'owner offline; frame dropped' };
    return { ok: true };
  }

  /** A seat was claimed (`POST /v1/c/:id/join`). */
  joined(channelId: string, peer: PeerRow) {
    this.toOwner(channelId, { t: 'join', peerId: peer.peerId, peerPub: peer.peerPub, at: peer.joinedAt });
  }

  /** The owner extended the channel. */
  extended(channelId: string, expiresAt: number) {
    this.toPeers(channelId, { t: 'extended', expiresAt });
  }

  /** Free a seat (重置查看者): the peer's token stops working and its connection closes. */
  async kick(channelId: string, peerId: string): Promise<boolean> {
    const removed = await this.storage.removePeer(channelId, peerId);
    const conn = this.peers.get(channelId)?.get(peerId);
    if (conn) {
      this.peers.get(channelId)!.delete(peerId);
      conn.send(JSON.stringify({ t: 'closed', reason: 'kicked' } satisfies PeerInFrame));
      conn.close(CLOSE.kicked, 'kicked');
    }
    if (removed) this.toOwner(channelId, { t: 'leave', peerId, at: this.now() });
    return removed;
  }

  // --- lifecycle -----------------------------------------------------------------------

  /** Close a channel in storage and tell everyone connected. */
  async close(channelId: string, reason: CloseReason): Promise<boolean> {
    const status = reason === 'expired' ? 'expired' : 'closed';
    const changed = await this.storage.closeChannel(channelId, status, reason, this.now());
    this.disconnectAll(channelId, reason);
    return changed;
  }

  /** Tell sockets the channel is gone and drop them (storage already updated). */
  disconnectAll(channelId: string, reason: CloseReason) {
    const owner = this.owners.get(channelId);
    this.owners.delete(channelId);
    const peers = this.peers.get(channelId);
    this.peers.delete(channelId);
    if (owner) {
      owner.send(JSON.stringify({ t: 'closed', reason } satisfies OwnerInFrame));
      owner.close(CLOSE.closed, reason);
    }
    for (const c of peers?.values() ?? []) {
      c.send(JSON.stringify({ t: 'closed', reason } satisfies PeerInFrame));
      c.close(CLOSE.closed, reason);
    }
  }

  async gc(): Promise<{ expired: number }> {
    const { expired } = await this.storage.gc(this.now(), this.config.closedRetentionMs);
    for (const id of expired) this.disconnectAll(id, 'expired');
    this.limiter.sweep();
    if (expired.length) this.log.log('info', 'gc', { expired: expired.length });
    return { expired: expired.length };
  }

  start() {
    this.timer ??= setInterval(() => {
      this.gc().catch((e: unknown) => this.log.log('error', 'gc_failed', { name: (e as Error)?.name }));
    }, this.config.gcIntervalMs);
  }

  /** Stop the GC loop and drop every connection (clients reconnect; channels persist). */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const c of this.owners.values()) c.close(CLOSE.goingAway, 'server shutting down');
    for (const m of this.peers.values()) for (const c of m.values()) c.close(CLOSE.goingAway, 'server shutting down');
    this.owners.clear();
    this.peers.clear();
  }

  get stats() {
    let peers = 0;
    for (const m of this.peers.values()) peers += m.size;
    return { owners: this.owners.size, peers };
  }
}
