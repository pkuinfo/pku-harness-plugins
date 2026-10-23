/**
 * Plugin server functions (docs/CLOUD-FUNCTIONS.md):
 *
 * - `POST /v1/fn/:plugin/:name`: a device token with `functions` for :plugin that carries the
 *   consented document (`doc` claim: link + hash). Runs `access: user` (and `public`) functions
 *   with `caller.id` = the device's pseudonym for this plugin.
 * - `GET|POST /v1/p/:plugin/:name`: `access: public` functions, no token, per-IP rate limit,
 *   `cache` honoured. The document comes from `CLOUD_FN_LOCAL` or the operator's policy entries.
 *
 * Per plugin per day: `callsPerDay` calls and `requestsPerDay` outbound requests. Log lines carry
 * the plugin, function, status and time — never inputs, results, secrets or pseudonyms.
 */
import { functionRequest, functionResponse } from '@pku-harness/cloud-protocol';
import { durationMs } from '@pku-harness/sdk/lang/schema';
import type { Context, Hono } from 'hono';

import type { AppEnv, Deps } from '../context';
import { HttpError, readJson } from '../errors';
import { limit } from '../limits';
import type { CompiledDoc } from '../fn/docs';
import { type Caller, inputFromQuery, parseInput, runFunction } from '../fn/run';
import { requireToken } from './auth';

const NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const PLUGIN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Results of cached public functions, by (plugin, hash, function, input). */
export class ResultCache {
  private m = new Map<string, { v: unknown; until: number }>();
  constructor(private readonly max: number) {}
  get(key: string, now: number) {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.until <= now) {
      this.m.delete(key);
      return undefined;
    }
    return e;
  }
  set(key: string, v: unknown, until: number) {
    this.m.delete(key);
    this.m.set(key, { v, until });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
}

/** Sorted-key JSON, so `{a,b}` and `{b,a}` share a cache entry. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

export function fnRoutes(app: Hono<AppEnv>, deps: Deps) {
  const { functions: cfg } = deps.config;
  const day = { limit: cfg.callsPerDay, windowS: 86_400 };
  const runDeps = { cfg, storage: deps.storage, limiter: deps.limiter, fetch: deps.fn.fetch, now: deps.now, storeQuota: deps.config.limits.store };

  const params = (c: Context<AppEnv>) => {
    const plugin = c.req.param('plugin') ?? '';
    const name = c.req.param('name') ?? '';
    if (!PLUGIN.test(plugin) || !NAME.test(name)) throw new HttpError('not_found', 'no such function');
    return { plugin, name };
  };
  const allowed = (plugin: string, hash: string) => {
    if (!deps.fn.policy.allows(plugin, hash)) throw new HttpError('forbidden', `this server doesn't run ${plugin}'s server functions at this version (policy: ${deps.fn.policy.policy})`);
  };
  const sizeOk = (input: unknown) => {
    if (Buffer.byteLength(JSON.stringify(input)) > cfg.maxInputBytes) throw new HttpError('payload_too_large', `input exceeds ${cfg.maxInputBytes} bytes`);
  };
  const logged = async <T>(plugin: string, name: string, access: string, f: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    try {
      const out = await f();
      deps.log.log('info', 'fn', { plugin, fn: name, access, ok: true, ms: Math.round(performance.now() - t0) });
      return out;
    } catch (e) {
      deps.log.log('info', 'fn', { plugin, fn: name, access, ok: false, code: e instanceof HttpError ? e.code : 'server', ms: Math.round(performance.now() - t0) });
      throw e;
    }
  };

  app.post('/v1/fn/:plugin/:name', async (c) => {
    const { plugin, name } = params(c);
    const auth = await requireToken(c, deps, 'functions');
    if (auth.plg !== plugin) throw new HttpError('forbidden', 'the token is for another plugin');
    if (!auth.doc) throw new HttpError('doc_required', 'request the token with doc { link, hash } (the consented plugin document)');
    limit(c, deps.limiter, `fn:${auth.sub}:${plugin}`, deps.config.rates.fn);
    allowed(plugin, auth.doc.hash);
    const body = await readJson(c, functionRequest);
    sizeOk(body.input);
    const doc = await deps.fn.docs.get(plugin, auth.doc);
    const fn = doc.functions[name];
    if (!fn) throw new HttpError('not_found', 'no such function');
    if (fn.access !== 'user' && fn.access !== 'public') throw new HttpError('unsupported', `access: ${fn.access} functions are not served yet`);
    limit(c, deps.limiter, `fnday:${plugin}`, day);
    const caller: Caller = { deviceId: auth.sub, pseudonym: deps.tokens.pseudonym(plugin, auth.sub) };
    const result = await logged(plugin, name, fn.access, () => runFunction(runDeps, doc, name, parseInput(fn, body.input), caller));
    return c.json(functionResponse.parse({ result: result ?? null }));
  });

  const publicDoc = async (plugin: string): Promise<CompiledDoc> => {
    const local = await deps.fn.docs.local(plugin);
    if (local) return local;
    const claim = deps.fn.policy.publicDoc(plugin);
    if (!claim) throw new HttpError('not_found', 'no such function');
    return deps.fn.docs.get(plugin, claim);
  };

  type Fn = CompiledDoc['functions'][string];
  const pub = async (c: Context<AppEnv>, raw: (fn: Fn) => Promise<Record<string, unknown>> | Record<string, unknown>) => {
    const { plugin, name } = params(c);
    limit(c, deps.limiter, `fnp:${c.get('ip')}`, deps.config.rates.fnPublic);
    c.header('Access-Control-Allow-Origin', '*');
    const doc = await publicDoc(plugin);
    allowed(plugin, doc.hash);
    const fn = doc.functions[name];
    if (!fn || fn.access !== 'public') throw new HttpError('not_found', 'no such function');
    const input = parseInput(fn, await raw(fn));
    sizeOk(input);
    const ttl = fn.cache === undefined ? 0 : durationMs(fn.cache);
    const key = `${plugin}@${doc.hash}:${name}:${stable(input)}`;
    const now = deps.now();
    const hit = ttl > 0 ? deps.fn.results.get(key, now) : undefined;
    if (hit) {
      c.header('Cache-Control', `public, max-age=${Math.ceil((hit.until - now) / 1000)}`);
      c.header('X-Cache', 'hit');
      return c.json(functionResponse.parse({ result: hit.v }));
    }
    limit(c, deps.limiter, `fnday:${plugin}`, day);
    const result = (await logged(plugin, name, 'public', () => runFunction(runDeps, doc, name, input))) ?? null;
    if (ttl > 0) {
      deps.fn.results.set(key, result, now + ttl);
      c.header('Cache-Control', `public, max-age=${Math.ceil(ttl / 1000)}`);
      c.header('X-Cache', 'miss');
    } else c.header('Cache-Control', 'no-store');
    return c.json(functionResponse.parse({ result }));
  };

  app.get('/v1/p/:plugin/:name', (c) => pub(c, (fn) => inputFromQuery(fn, c.req.query())));
  app.post('/v1/p/:plugin/:name', (c) => pub(c, async () => (await readJson(c, functionRequest)).input));
  app.options('/v1/p/:plugin/:name', (c) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST');
    c.header('Access-Control-Allow-Headers', 'content-type');
    c.header('Access-Control-Max-Age', '86400');
    return c.body(null, 204);
  });

  app.all('/v1/fn/*', () => {
    throw new HttpError('not_found', 'no such function');
  });
}
