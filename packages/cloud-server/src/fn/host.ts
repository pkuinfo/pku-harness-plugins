/**
 * The server's side of the interpreter (docs/CLOUD-FUNCTIONS.md §3.2): the runnable ability table
 * (`SERVER_ABILITY_DEFS` from the SDK + implementations), the per-user server KV, a host-services
 * object that refuses everything phone-only, and the outbound fetch for `request` steps.
 */
import { createHmac, createHash, randomBytes } from 'node:crypto';

import { toB64url } from '@pku-harness/cloud-protocol';
import type { AbilityDef } from '@pku-harness/sdk/lang/abilities';
import { ToolFailure, type PublicFetch } from '@pku-harness/sdk/lang/run';
import { durationMs } from '@pku-harness/sdk/lang/schema';
import { SERVER_ABILITY_DEFS } from '@pku-harness/sdk/lang/server-schema';
import type { HostServices, KV } from '@pku-harness/sdk';

import type { Namespace, Storage } from '../db/storage';

// ---------------------------------------------------------------- KV

/**
 * Server KV of one (device, plugin), in the store table under the namespace plugin `fn:<id>`:
 * device tokens' plugin ids can't contain `:`, so clients never see it, and deleting the device
 * deletes it. Quotas are the store's (limits.store).
 */
export function serverKV(storage: Storage, deviceId: string, plugin: string, q: { maxKeys: number; maxBytes: number; maxValueBytes: number }, now: () => number): KV {
  const ns: Namespace = { deviceId, plugin: `fn:${plugin}` };
  const checkKey = (key: string) => {
    if (key.length > 256) throw new ToolFailure('kv keys are at most 256 characters');
  };
  return {
    async get<T>(key: string) {
      checkKey(key);
      const row = await storage.storeGet(ns, key, now());
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async set<T>(key: string, value: T) {
      checkKey(key);
      const json = JSON.stringify(value ?? null);
      if (Buffer.byteLength(json) > q.maxValueBytes) throw new ToolFailure(`kv value larger than ${q.maxValueBytes / 1000} KB`);
      const r = await storage.storePut(ns, key, json, { now: now(), maxKeys: q.maxKeys, maxBytes: q.maxBytes });
      if (!r.ok) throw new ToolFailure(r.reason === 'quota_keys' ? `server kv is full (${q.maxKeys} keys)` : `server kv is full (${q.maxBytes / 1e6} MB)`, 'quota');
    },
    async delete(key: string) {
      checkKey(key);
      await storage.storeDelete(ns, key, { now: now() });
    },
  };
}

/** KV for runs without a caller (public functions). */
export const noKV: KV = {
  get: () => Promise.reject(new ToolFailure('kv needs a signed-in caller (access: user)')),
  set: () => Promise.reject(new ToolFailure('kv needs a signed-in caller (access: user)')),
  delete: () => Promise.reject(new ToolFailure('kv needs a signed-in caller (access: user)')),
};

// ---------------------------------------------------------------- host services

const PHONE_ONLY = 'campus services and phone abilities are only available on the phone';

/** Every phone service refuses; crypto is the server's own. */
export const serverServices: HostServices = new Proxy({} as HostServices, {
  get(_t, prop) {
    if (prop === 'crypto') return { sha256: async (text: string) => createHash('sha256').update(text, 'utf8').digest('hex') };
    if (prop === 'campus')
      return new Proxy(
        {},
        {
          get: () => () => Promise.reject(new ToolFailure(PHONE_ONLY)),
        },
      );
    return new Proxy(
      {},
      {
        get: () => () => Promise.reject(new ToolFailure(PHONE_ONLY)),
      },
    );
  },
});

// ---------------------------------------------------------------- abilities

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const later = (what: string) => async (): Promise<never> => {
  // TODO(stage 3, docs/CLOUD-FUNCTIONS.md §4 / stage 5 §5): collections and push.
  throw new ToolFailure(`${what} are not available on this server yet`, 'unsupported');
};

/** The runnable server ability table for one run. `secrets` back `crypto.hmacSha256 { secret }`. */
export function serverAbilities(opts: { secrets: Record<string, string>; now: () => number }): Record<string, AbilityDef> {
  const impl: Record<string, AbilityDef['run']> = {
    'kv.get': async (a, e) => {
      const v = await e.kv.get<{ v: unknown; exp?: number }>(`doc:${str(a.key)}`);
      return !v || (v.exp && v.exp < opts.now()) ? null : v.v;
    },
    'kv.set': async (a, e) => {
      const value = a.value === undefined ? null : JSON.parse(JSON.stringify(a.value));
      await e.kv.set(`doc:${str(a.key)}`, { v: value, exp: a.ttl == null ? undefined : opts.now() + durationMs(a.ttl as string) });
      return value;
    },
    'kv.delete': async (a, e) => {
      await e.kv.delete(`doc:${str(a.key)}`);
      return null;
    },
    'crypto.sha256': async (a) => createHash('sha256').update(str(a.text), 'utf8').digest('hex'),
    'crypto.hmacSha256': async (a) => {
      let key: string;
      if (a.secret !== undefined) {
        const v = opts.secrets[str(a.secret)];
        if (v === undefined) throw new ToolFailure(`secret ${str(a.secret)} is not declared or not set on this server`);
        key = v;
      } else key = str(a.key);
      return createHmac('sha256', key).update(str(a.text), 'utf8').digest('hex');
    },
    'crypto.randomId': async (a) => {
      const n = a.bytes === undefined ? 16 : Number(a.bytes);
      if (!Number.isInteger(n) || n < 8 || n > 32) throw new ToolFailure('randomId: bytes must be 8–32');
      return toB64url(new Uint8Array(randomBytes(n)));
    },
    'collection.add': later('collections'),
    'collection.get': later('collections'),
    'collection.query': later('collections'),
    'collection.update': later('collections'),
    'collection.remove': later('collections'),
    'collection.count': later('collections'),
    'push.send': later('push notifications'),
  };
  const table: Record<string, AbilityDef> = {};
  for (const [id, def] of Object.entries(SERVER_ABILITY_DEFS)) {
    const run = impl[id];
    if (!run) throw new Error(`server ability ${id} has no implementation`);
    table[id] = { ...def, run };
  }
  return table;
}

// ---------------------------------------------------------------- fetch

function hostAllowed(host: string, allowed: string[]) {
  const h = host.toLowerCase();
  return allowed.some((a) => (a.startsWith('*.') ? h.endsWith(a.slice(1).toLowerCase()) || h === a.slice(2).toLowerCase() : h === a.toLowerCase()));
}

/** IP literals (v4 or bracketed v6): server steps must name hosts, which keeps metadata and LAN addresses out. */
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/;

async function readCapped(res: Response, max: number): Promise<string> {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) throw new ToolFailure(`response larger than ${max / 1e6} MB`);
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new ToolFailure(`response larger than ${max / 1e6} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Outbound HTTP for `request` steps: HTTPS only, declared hosts only (every redirect hop is
 * checked, not just the last), no IP literals, a timeout and a body cap. `onRequest` runs before
 * each hop (daily quotas).
 *
 * TODO: names that resolve to private addresses (DNS rebinding) need a resolver check before
 * connecting; today only literals are refused.
 */
export function serverFetch(opts: { fetch: typeof fetch; network: string[]; maxBytes: number; onRequest: () => void }): PublicFetch {
  return async (req) => {
    let url = req.url;
    let method = req.method;
    let body = req.body;
    for (let hop = 0; hop <= 5; hop++) {
      const u = new URL(url);
      if (u.protocol !== 'https:') throw new ToolFailure(`only https:// is allowed (${u.host})`);
      if (IP_LITERAL.test(u.hostname)) throw new ToolFailure('server requests must use a host name, not an IP address');
      if (!hostAllowed(u.hostname, opts.network)) throw new ToolFailure(`${hop ? 'the request was redirected to' : 'host'} ${u.hostname}, which is not declared in server.network`);
      opts.onRequest();
      let res: Response;
      try {
        res = await opts.fetch(url, { method, headers: req.headers, body, redirect: 'manual', signal: AbortSignal.timeout(req.timeoutMs) });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        throw new ToolFailure(timedOut ? `${u.host} did not answer within ${Math.round(req.timeoutMs / 1000)} s` : `could not reach ${u.host}`);
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc && req.followRedirects) {
        url = new URL(loc, url).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
        }
        await res.body?.cancel().catch(() => {});
        continue;
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { status: res.status, url, headers, body: await readCapped(res, opts.maxBytes) };
    }
    throw new ToolFailure('too many redirects');
  };
}
