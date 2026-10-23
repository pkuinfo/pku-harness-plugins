/**
 * Owner side of channels: create, extend, close, and the owner WebSocket. The server stores
 * the join hash, channel public key and sealed meta; it never sees the link secret.
 */
import { randomBytes } from 'node:crypto';

import {
  channelIdSchema,
  closeChannelResponse,
  createChannelRequest,
  createChannelResponse,
  patchChannelRequest,
  patchChannelResponse,
  toB64url,
} from '@pku-harness/cloud-protocol';
import type { Context, Hono } from 'hono';

import type { AppEnv, Deps, SocketData } from '../context';
import type { ChannelRow } from '../db/storage';
import { HttpError, parseWith, readJson } from '../errors';
import { limit } from '../limits';
import { requireToken } from './auth';

export const isLive = (ch: ChannelRow, now: number) => ch.status === 'open' && ch.expiresAt > now;

/** Hand the request to Bun's native WebSocket server (handlers in index.ts). */
export function upgrade(c: Context<AppEnv>, data: SocketData): Response {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') throw new HttpError('bad_request', 'expected a WebSocket upgrade', undefined, 426);
  const server = c.env?.server;
  if (!server?.upgrade(c.req.raw, { data })) throw new HttpError('server', 'WebSocket upgrade failed');
  // Bun ignores the response once the socket is upgraded.
  return new Response(null);
}

/** Load a channel the token's (device, plugin) owns. */
export async function ownedChannel(c: Context<AppEnv>, deps: Deps, allowQuery = false): Promise<ChannelRow> {
  const auth = await requireToken(c, deps, 'channels', allowQuery);
  const id = parseWith(channelIdSchema, c.req.param('id'));
  const ch = await deps.storage.getChannel(id);
  if (!ch) throw new HttpError('not_found', 'no such channel');
  if (ch.deviceId !== auth.sub || ch.plugin !== auth.plg) throw new HttpError('forbidden', 'not the channel owner');
  limit(c, deps.limiter, `svc:${auth.sub}:${auth.plg}:channels`, deps.config.rates.channels);
  return ch;
}

export function channelRoutes(app: Hono<AppEnv>, deps: Deps) {
  const lim = deps.config.limits.channels;

  app.post('/v1/channels', async (c) => {
    const auth = await requireToken(c, deps, 'channels');
    limit(c, deps.limiter, `svc:${auth.sub}:${auth.plg}:channels`, deps.config.rates.channels);
    const body = await readJson(c, createChannelRequest);
    if (body.ttlS < lim.minTtlS || body.ttlS > lim.maxTtlS) throw new HttpError('bad_request', `ttlS must be ${lim.minTtlS}–${lim.maxTtlS}`);
    if (body.maxPeers > lim.maxPeers) throw new HttpError('bad_request', `maxPeers must be ≤ ${lim.maxPeers}`);
    if (body.page && !deps.pages.has(auth.plg, body.page)) throw new HttpError('bad_request', 'page is not served for this plugin');
    const now = deps.now();
    const row: ChannelRow = {
      id: toB64url(new Uint8Array(randomBytes(16))),
      deviceId: auth.sub,
      plugin: auth.plg,
      joinHash: body.joinHash,
      chanPub: body.chanPub,
      meta: body.meta,
      ...(body.page ? { page: body.page } : {}),
      maxPeers: body.maxPeers,
      createdAt: now,
      expiresAt: now + body.ttlS * 1000,
      status: 'open',
      failedJoins: 0,
    };
    if (!(await deps.storage.createChannel(row, lim.maxOpen))) throw new HttpError('quota', `at most ${lim.maxOpen} open channels per device`);
    return c.json(createChannelResponse.parse({ id: row.id, expiresAt: row.expiresAt }));
  });

  app.patch('/v1/channels/:id', async (c) => {
    const ch = await ownedChannel(c, deps);
    const body = await readJson(c, patchChannelRequest);
    const now = deps.now();
    if (!isLive(ch, now)) throw new HttpError('gone', 'channel closed or expired');
    const expiresAt = now + Math.min(body.ttlS, lim.maxTtlS) * 1000;
    await deps.storage.setChannelExpiry(ch.id, expiresAt);
    deps.hub.extended(ch.id, expiresAt);
    return c.json(patchChannelResponse.parse({ expiresAt }));
  });

  app.delete('/v1/channels/:id', async (c) => {
    const ch = await ownedChannel(c, deps);
    if (ch.status === 'open') await deps.hub.close(ch.id, 'owner');
    return c.json(closeChannelResponse.parse({ ok: true }));
  });

  /** Owner WebSocket. Token in `Authorization`, or `?t=` for clients that can't set headers. */
  app.get('/v1/channels/:id/ws', async (c) => {
    const ch = await ownedChannel(c, deps, true);
    if (!isLive(ch, deps.now())) throw new HttpError('gone', 'channel closed or expired');
    return upgrade(c, { kind: 'owner', channelId: ch.id, maxPeers: ch.maxPeers });
  });
}
