/**
 * Public and peer side of channels: info, join (claim a seat), peer WebSocket, and the SSE +
 * POST fallback for webviews without WebSocket (WeChat).
 */
import { randomBytes } from 'node:crypto';

import {
  channelIdSchema,
  channelInfoResponse,
  equalBytes,
  fromB64url,
  joinHash,
  joinRequest,
  joinResponse,
  peerOutFrame,
  peerSendResponse,
  toB64url,
} from '@pku-harness/cloud-protocol';
import type { Context, Hono } from 'hono';

import { bearer } from '../auth/token';
import type { Conn } from '../channels/hub';
import type { AppEnv, Deps } from '../context';
import type { ChannelRow, PeerRow } from '../db/storage';
import { HttpError, parseWith, readJson } from '../errors';
import { limit } from '../limits';
import { isLive, upgrade } from './channels';

const PEER_TOKEN_MAX_MS = 30 * 86_400_000;

/** Resolve the peer token (header or `?t=`) to its live channel and claimed seat. */
export async function peerAuth(c: Context<AppEnv>, deps: Deps): Promise<{ ch: ChannelRow; peer: PeerRow }> {
  const id = parseWith(channelIdSchema, c.req.param('id'));
  const raw = bearer(c.req.raw, true);
  if (!raw) throw new HttpError('unauthorized', 'missing peer token');
  const now = deps.now();
  const claims = deps.tokens.verifyPeer(raw, now);
  if (!claims || claims.cid !== id) throw new HttpError('unauthorized', 'invalid or expired peer token');
  const ch = await deps.storage.getChannel(id);
  if (!ch) throw new HttpError('not_found', 'no such channel');
  if (!isLive(ch, now)) throw new HttpError('gone', 'channel closed or expired');
  const peer = await deps.storage.getPeer(id, claims.pid);
  if (!peer) throw new HttpError('forbidden', 'seat no longer claimed');
  limit(c, deps.limiter, `peer:${id}:${peer.peerId}`, deps.config.rates.peer);
  return { ch, peer };
}

export function peerRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.get('/v1/c/:id', async (c) => {
    limit(c, deps.limiter, `info:${c.get('ip')}`, deps.config.rates.publicInfo);
    const id = parseWith(channelIdSchema, c.req.param('id'));
    const ch = await deps.storage.getChannel(id);
    if (!ch) throw new HttpError('not_found', 'no such channel');
    const status = ch.status === 'open' && ch.expiresAt <= deps.now() ? 'expired' : ch.status;
    c.header('Cache-Control', 'no-store');
    return c.json(channelInfoResponse.parse({ status, meta: ch.meta, chanPub: ch.chanPub, expiresAt: ch.expiresAt, ownerOnline: deps.hub.ownerOnline(id) }));
  });

  app.post('/v1/c/:id/join', async (c) => {
    limit(c, deps.limiter, `join:${c.get('ip')}`, deps.config.rates.joins);
    const id = parseWith(channelIdSchema, c.req.param('id'));
    const body = await readJson(c, joinRequest);
    const ch = await deps.storage.getChannel(id);
    if (!ch) throw new HttpError('not_found', 'no such channel');
    const now = deps.now();
    if (!isLive(ch, now)) throw new HttpError('gone', 'channel closed or expired');
    if (!equalBytes(fromB64url(joinHash(fromB64url(body.authKey))), fromB64url(ch.joinHash))) {
      const fails = await deps.storage.failJoin(id);
      if (fails >= deps.config.maxFailedJoins) {
        await deps.hub.close(id, 'locked');
        deps.log.log('warn', 'channel_locked', { fails });
      }
      throw new HttpError('forbidden', 'wrong key');
    }
    const peer: PeerRow = { channelId: id, peerId: toB64url(new Uint8Array(randomBytes(9))), peerPub: body.peerPub, joinedAt: now };
    if (!(await deps.storage.claimPeer(peer, ch.maxPeers))) throw new HttpError('conflict', 'channel already claimed');
    // The claim is the real gate (kick or close revokes it); exp only bounds a leaked token,
    // and must outlast repeated extensions of the channel.
    const peerToken = deps.tokens.signPeer({ cid: id, pid: peer.peerId, iat: now, exp: now + PEER_TOKEN_MAX_MS });
    deps.hub.joined(id, peer);
    return c.json(joinResponse.parse({ peerId: peer.peerId, peerToken, expiresAt: ch.expiresAt }));
  });

  app.get('/v1/c/:id/ws', async (c) => {
    const { ch, peer } = await peerAuth(c, deps);
    return upgrade(c, { kind: 'peer', channelId: ch.id, peerId: peer.peerId });
  });

  /** Server-sent events: the same frames as the peer WebSocket, one JSON per `data:` line. */
  app.get('/v1/c/:id/events', async (c) => {
    const { ch, peer } = await peerAuth(c, deps);
    const enc = new TextEncoder();
    let conn: Conn | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let open = true;
    const stop = () => {
      if (!open) return;
      open = false;
      if (heartbeat) clearInterval(heartbeat);
      if (conn) deps.hub.detachPeer(ch.id, peer.peerId, conn);
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (s: string) => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(s));
          } catch {
            stop();
          }
        };
        conn = {
          send: (data) => write(`data: ${data}\n\n`),
          close: () => {
            stop();
            try {
              controller.close();
            } catch {
              // already closed
            }
          },
        };
        write('retry: 3000\n\n');
        heartbeat = setInterval(() => write(': ping\n\n'), deps.config.sseHeartbeatMs);
        void deps.hub.attachPeer(ch, peer.peerId, conn);
      },
      cancel: stop,
    });
    c.req.raw.signal.addEventListener('abort', stop);
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
    });
  });

  /** Peer → owner frame for SSE clients. */
  app.post('/v1/c/:id/send', async (c) => {
    const { ch, peer } = await peerAuth(c, deps);
    const frame = await readJson(c, peerOutFrame);
    const r = await deps.hub.peerFrame(ch.id, peer.peerId, frame);
    if (!r.ok) throw new HttpError(r.code, r.message);
    return c.json(peerSendResponse.parse({ ok: true }));
  });
}
