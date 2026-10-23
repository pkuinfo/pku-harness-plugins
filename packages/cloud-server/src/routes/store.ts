/**
 * KV store. The namespace is `(deviceId, plugin)` from the token — never from the path — so a
 * plugin can't read another plugin's keys and devices can't read each other's. Values are
 * stored as the JSON the client sent (envelopes for e2e plugins); `If-Match` gives optimistic
 * concurrency (`0` = must not exist).
 */
import {
  storeDeleteResponse,
  storeGetResponse,
  storeKeySchema,
  storeListResponse,
  storePutRequest,
  storePutResponse,
} from '@pku-harness/cloud-protocol';
import type { Context, Hono } from 'hono';

import type { AppEnv, Deps } from '../context';
import { HttpError, parseWith, readJson } from '../errors';
import { limit } from '../limits';
import { requireToken } from './auth';

const PREFIX_RE = /^[A-Za-z0-9._:/-]{0,256}$/;

function ifMatch(c: Context<AppEnv>): number | undefined {
  const h = c.req.header('if-match');
  if (h === undefined) return undefined;
  const m = /^(?:W\/)?"?(0|[1-9][0-9]{0,15})"?$/.exec(h.trim());
  if (!m) throw new HttpError('bad_request', 'If-Match must be a version number');
  return Number(m[1]);
}

export function storeRoutes(app: Hono<AppEnv>, deps: Deps) {
  const guard = async (c: Context<AppEnv>) => {
    const auth = await requireToken(c, deps, 'store');
    limit(c, deps.limiter, `svc:${auth.sub}:${auth.plg}:store`, deps.config.rates.store);
    return { deviceId: auth.sub, plugin: auth.plg };
  };
  const keyOf = (c: Context<AppEnv>) => parseWith(storeKeySchema, c.req.param('key'));
  const { store: q } = deps.config.limits;

  app.get('/v1/store', async (c) => {
    const ns = await guard(c);
    const prefix = c.req.query('prefix') ?? '';
    if (!PREFIX_RE.test(prefix)) throw new HttpError('bad_request', 'invalid prefix');
    const rows = await deps.storage.storeList(ns, prefix, deps.now(), q.maxKeys);
    return c.json(storeListResponse.parse({ items: rows.map((r) => ({ key: r.key, version: r.version, updatedAt: r.updatedAt })) }));
  });

  app.get('/v1/store/:key{.+}', async (c) => {
    const ns = await guard(c);
    const row = await deps.storage.storeGet(ns, keyOf(c), deps.now());
    if (!row) throw new HttpError('not_found', 'no such key');
    c.header('ETag', `"${row.version}"`);
    return c.json(
      storeGetResponse.parse({ key: row.key, value: JSON.parse(row.value), version: row.version, updatedAt: row.updatedAt, ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}) }),
    );
  });

  app.put('/v1/store/:key{.+}', async (c) => {
    const ns = await guard(c);
    const key = keyOf(c);
    const body = await readJson(c, storePutRequest);
    if (body.value === undefined) throw new HttpError('bad_request', 'invalid fields: value');
    const value = JSON.stringify(body.value);
    if (Buffer.byteLength(value) > q.maxValueBytes) throw new HttpError('payload_too_large', `value exceeds ${q.maxValueBytes} bytes`);
    const now = deps.now();
    const r = await deps.storage.storePut(ns, key, value, {
      now,
      ifVersion: ifMatch(c),
      expiresAt: body.ttlS ? now + body.ttlS * 1000 : undefined,
      maxKeys: q.maxKeys,
      maxBytes: q.maxBytes,
    });
    if (!r.ok) {
      if (r.reason === 'conflict') throw new HttpError('conflict', 'version mismatch');
      throw new HttpError('quota', r.reason === 'quota_keys' ? `at most ${q.maxKeys} keys per plugin` : `at most ${q.maxBytes} bytes per plugin`);
    }
    c.header('ETag', `"${r.version}"`);
    return c.json(storePutResponse.parse({ version: r.version }));
  });

  app.delete('/v1/store/:key{.+}', async (c) => {
    const ns = await guard(c);
    const r = await deps.storage.storeDelete(ns, keyOf(c), { now: deps.now(), ifVersion: ifMatch(c) });
    if (r === 'conflict') throw new HttpError('conflict', 'version mismatch');
    return c.json(storeDeleteResponse.parse({ ok: true }));
  });
}
