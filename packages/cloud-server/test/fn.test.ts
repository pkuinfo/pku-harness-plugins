import { afterEach, describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type CloudServiceName, type DocClaim, errorBody, functionResponse, metaResponse, paths, signAuthChallenge } from '@pku-harness/cloud-protocol';

import { type FunctionsConfig, defaultFunctions, secretEnvName } from '../src/config';
import { DocCache } from '../src/fn/docs';
import { runFunction } from '../src/fn/run';
import { HttpError } from '../src/errors';
import { PUBLIC_URL, type TestDevice, type TestServer, makeServer, registerDevice } from './helpers';

const FIXTURES = join(import.meta.dir, 'fixtures');
const PLUGIN = 'fn-demo';
const SECRET = 'sk-live-3f9a1c77e0b24d6a';
const LINK = `https://github.com/pkuinfo/plugins-fixture/tree/main/${PLUGIN}`;
const RAW = `https://raw.githubusercontent.com/pkuinfo/plugins-fixture/main/${PLUGIN}/`;

const HASH = (await new DocCache({ fetch, localDir: FIXTURES, allowLocalHttp: false, max: 4, now: Date.now }).local(PLUGIN))!.hash;

/** A fake internet: the fixture plugin on "GitHub" and api.example.org. */
function fakeNet() {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  let count = 0;
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    seen.push({ url, headers });
    if (url.startsWith(RAW)) {
      try {
        return new Response(readFileSync(join(FIXTURES, PLUGIN, url.slice(RAW.length)), 'utf8'));
      } catch {
        return new Response('nope', { status: 404 });
      }
    }
    const u = new URL(url);
    if (u.host === 'api.example.org') {
      if (u.pathname === '/v1/echo') return Response.json({ url, headers });
      if (u.pathname === '/v1/count') return Response.json({ count: ++count });
      if (u.pathname === '/v1/fail') return new Response(`bad key ${headers['x-key']}`, { status: 500 });
      if (u.pathname === '/v1/redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.com/steal' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: f, seen, count: () => count };
}

let s: TestServer;
afterEach(() => s?.close());

async function server(fn: Partial<FunctionsConfig> = {}, net = fakeNet(), extra: Parameters<typeof makeServer>[0] = {}) {
  const functions: FunctionsConfig = { ...defaultFunctions({}), policy: 'open', localDir: FIXTURES, secrets: { [secretEnvName(PLUGIN, 'API_KEY')]: SECRET }, ...fn };
  s = await makeServer({ functions, ...extra, fetch: net.fetch });
  return net;
}

async function fnToken(dev: TestDevice, doc: DocClaim | undefined, services: CloudServiceName[] = ['functions'], plugin = PLUGIN) {
  const body = signAuthChallenge({ aud: PUBLIC_URL, deviceId: dev.id, plugin, services, doc, now: s.clock.now }, dev.identity.sign.secretKey);
  const r = await s.request(paths.authToken(), { method: 'POST', json: body });
  if (r.status !== 200) throw new Error(`token failed: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { token: string }).token;
}

const call = (token: string, name: string, input: unknown = {}) => s.request(paths.fn(PLUGIN, name), { method: 'POST', token, json: { input } });
const errOf = async (r: Response) => errorBody.parse(await r.json()).error;

describe('POST /v1/fn (access: user)', () => {
  test('token with doc → invoke: kv, crypto, request with a secret; secrets never leave', async () => {
    const net = await server();
    const dev = await registerDevice(s);
    const token = await fnToken(dev, { link: LINK, hash: HASH });
    const name = 'Zhang-unique-input';
    const r = await call(token, 'visit', { name });
    expect(r.status).toBe(200);
    const { result } = functionResponse.parse(await r.json()) as { result: Record<string, unknown> };
    expect(result.visits).toBe(1);
    expect(result.tag).toBe(createHash('sha256').update(name).digest('hex'));
    expect(result.sig).toBe(createHmac('sha256', SECRET).update(name).digest('hex'));
    expect(result.ridLength).toBe(22);
    // caller.id is the per-plugin pseudonym, not the device id
    expect(result.me).toBe(s.deps.tokens.pseudonym(PLUGIN, dev.id));
    expect(result.me).not.toBe(dev.id);
    expect(s.deps.tokens.pseudonym('other-plugin', dev.id)).not.toBe(result.me);
    // the upstream got the real secret; the caller only sees it scrubbed
    const upstream = net.seen.find((x) => x.url.includes('/v1/echo'))!;
    expect(upstream.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect((result.echo as { headers: Record<string, string> }).headers.authorization).toBe('Bearer [secret]');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    // kv persists per (device, plugin)
    const again = functionResponse.parse(await (await call(token, 'visit', { name })).json()) as { result: { visits: number } };
    expect(again.result.visits).toBe(2);
    const other = await registerDevice(s);
    const fresh = functionResponse.parse(await (await call(await fnToken(other, { link: LINK, hash: HASH }), 'visit', {})).json()) as { result: { visits: number } };
    expect(fresh.result.visits).toBe(1);
    // logs: plugin and function names only
    const logs = s.log.lines.join('\n');
    expect(logs).toContain('"event":"fn"');
    for (const secretish of [SECRET, name, result.me as string, dev.id]) expect(logs).not.toContain(secretish);
    // the server KV is invisible to the device's own store namespace
    expect(await s.deps.storage.storeGet({ deviceId: dev.id, plugin: PLUGIN }, 'doc:visits', s.clock.now)).toBeUndefined();
  });

  test('doc claim required; services, plugin and input checked', async () => {
    await server();
    const dev = await registerDevice(s);
    const noDoc = await call(await fnToken(dev, undefined), 'visit');
    expect(noDoc.status).toBe(400);
    expect((await errOf(noDoc)).code).toBe('doc_required');
    const storeOnly = await call(await fnToken(dev, { link: LINK, hash: HASH }, ['store']), 'visit');
    expect(storeOnly.status).toBe(403);
    const wrongPlugin = await call(await fnToken(dev, { link: LINK, hash: HASH }, ['functions'], 'card-share'), 'visit');
    expect((await errOf(wrongPlugin)).message).toBe('the token is for another plugin');
    const token = await fnToken(dev, { link: LINK, hash: HASH });
    expect((await call(token, 'nope')).status).toBe(404);
    const bad = await call(token, 'visit', { name: 42 });
    expect(bad.status).toBe(400);
    expect((await errOf(bad)).message).toBe('invalid input: name');
  });

  test('a document that does not match the consented hash is refused', async () => {
    await server();
    const dev = await registerDevice(s);
    const r = await call(await fnToken(dev, { link: LINK, hash: 'f'.repeat(64) }), 'visit');
    expect(r.status).toBe(409);
    expect((await errOf(r)).message).toContain('hash mismatch');
  });

  test('remote documents: fetched by link, hash-checked, cached', async () => {
    const net = await server({ localDir: undefined });
    const dev = await registerDevice(s);
    const token = await fnToken(dev, { link: LINK, hash: HASH });
    expect((await call(token, 'visit')).status).toBe(200);
    expect((await call(token, 'visit')).status).toBe(200);
    expect(net.seen.filter((x) => x.url.startsWith(RAW)).length).toBe(1);
    // a verified (plugin, hash) is served from the cache whatever the link; an unknown one needs a fetchable link
    expect((await call(await fnToken(dev, { link: 'file:///plugins/fn-demo', hash: HASH }), 'visit')).status).toBe(200);
    const fileLink = await call(await fnToken(dev, { link: 'file:///plugins/fn-demo', hash: 'e'.repeat(64) }), 'visit');
    expect(fileLink.status).toBe(404);
    expect((await errOf(fileLink)).message).toContain('CLOUD_FN_LOCAL');
  });

  test('policy: allowlist and verified', async () => {
    await server({ policy: 'allowlist', allow: ['other@*'] });
    let dev = await registerDevice(s);
    const denied = await call(await fnToken(dev, { link: LINK, hash: HASH }), 'visit');
    expect(denied.status).toBe(403);
    expect((await errOf(denied)).message).toContain('policy: allowlist');
    expect(metaResponse.parse(await (await s.request(paths.meta())).json()).serverFunctions).toEqual({ policy: 'allowlist' });
    s.close();

    await server({ policy: 'allowlist', allow: [`${PLUGIN}@${HASH}`] });
    dev = await registerDevice(s);
    expect((await call(await fnToken(dev, { link: LINK, hash: HASH }), 'visit')).status).toBe(200);
    s.close();

    const file = join(mkdtempSync(join(tmpdir(), 'fn-verified-')), 'verified.json');
    writeFileSync(file, JSON.stringify({ [PLUGIN]: ['0'.repeat(64)] }));
    await server({ policy: 'verified', verifiedFile: file });
    dev = await registerDevice(s);
    const token = await fnToken(dev, { link: LINK, hash: HASH });
    expect((await call(token, 'visit')).status).toBe(403);
    writeFileSync(file, JSON.stringify({ [PLUGIN]: { link: LINK, hashes: [HASH] } }));
    // the file is re-read when it changes (mtime); force a different mtime on fast filesystems
    const { utimesSync } = await import('node:fs');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect((await call(token, 'visit')).status).toBe(200);
  });

  test('failures: messages scrubbed of secrets, redirects off the network refused, later abilities 501', async () => {
    await server();
    const dev = await registerDevice(s);
    const token = await fnToken(dev, { link: LINK, hash: HASH });
    const leak = await call(token, 'leak');
    expect(leak.status).toBe(422);
    const e = await errOf(leak);
    expect(e.code).toBe('failed');
    expect(e.message).toBe('upstream said bad key [secret]');
    const hop = await errOf(await call(token, 'hop'));
    expect(hop.message).toContain('redirected to evil.com');
    const later = await call(token, 'later');
    expect(later.status).toBe(501);
    expect((await errOf(later)).message).toContain('collections are not available');
    expect(s.log.lines.join('\n')).not.toContain(SECRET);
  });

  test('quotas: per-plugin calls per day → 429', async () => {
    await server({ callsPerDay: 2 });
    const dev = await registerDevice(s);
    const token = await fnToken(dev, { link: LINK, hash: HASH });
    expect((await call(token, 'visit')).status).toBe(200);
    expect((await call(token, 'visit')).status).toBe(200);
    const r = await call(token, 'visit');
    expect(r.status).toBe(429);
    expect((await errOf(r)).code).toBe('rate_limited');
    expect(r.headers.get('retry-after')).toBeTruthy();
  });

  test('quotas: outbound requests per day', async () => {
    await server({ requestsPerDay: 1 });
    const dev = await registerDevice(s);
    const token = await fnToken(dev, { link: LINK, hash: HASH });
    expect((await call(token, 'visit')).status).toBe(200);
    const r = await call(token, 'visit');
    expect(r.status).toBe(429);
    expect((await errOf(r)).message).toContain('daily outbound request quota');
  });
});

describe('GET|POST /v1/p (access: public)', () => {
  test('runs public functions, honours cache, coerces query input', async () => {
    const net = await server();
    const r1 = await s.request(`${paths.publicFn(PLUGIN, 'stats')}?n=3`);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('access-control-allow-origin')).toBe('*');
    expect(r1.headers.get('x-cache')).toBe('miss');
    expect(functionResponse.parse(await r1.json()).result).toEqual({ count: 1, n: 3 });
    const r2 = await s.request(paths.publicFn(PLUGIN, 'stats'), { method: 'POST', json: { input: { n: 3 } } });
    expect(r2.headers.get('x-cache')).toBe('hit');
    expect(functionResponse.parse(await r2.json()).result).toEqual({ count: 1, n: 3 });
    expect(net.count()).toBe(1);
    s.clock.advance(31_000);
    const r3 = await s.request(`${paths.publicFn(PLUGIN, 'stats')}?n=3`);
    expect(functionResponse.parse(await r3.json()).result).toEqual({ count: 2, n: 3 });
    // no caller identity, and no access to user functions
    expect(functionResponse.parse(await (await s.request(paths.publicFn(PLUGIN, 'whoami'))).json()).result).toEqual({ caller: null });
    expect((await s.request(paths.publicFn(PLUGIN, 'visit'))).status).toBe(404);
    expect((await s.request(`${paths.publicFn(PLUGIN, 'stats')}?n=x`)).status).toBe(400);
  });

  test('per-IP rate limit', async () => {
    await server({}, fakeNet(), { rates: { fnPublic: { limit: 2, windowS: 60 } } });
    expect((await s.request(paths.publicFn(PLUGIN, 'whoami'))).status).toBe(200);
    expect((await s.request(paths.publicFn(PLUGIN, 'whoami'))).status).toBe(200);
    expect((await s.request(paths.publicFn(PLUGIN, 'whoami'))).status).toBe(429);
    expect((await s.request(paths.publicFn(PLUGIN, 'whoami'), { headers: { 'x-forwarded-for': '10.0.0.2' } })).status).toBe(200);
  });

  test('document from the policy entry (link + hash) when there is no local copy', async () => {
    await server({ localDir: undefined });
    expect((await s.request(paths.publicFn(PLUGIN, 'whoami'))).status).toBe(404);
    s.close();
    await server({ localDir: undefined, policy: 'allowlist', allow: [`${PLUGIN}@${HASH}=${LINK}`] });
    expect((await s.request(paths.publicFn(PLUGIN, 'whoami'))).status).toBe(200);
    s.close();
    await server({ policy: 'allowlist', allow: [] });
    expect((await s.request(paths.publicFn(PLUGIN, 'whoami'))).status).toBe(403);
  });
});

describe('runFunction', () => {
  test('campus requests fail with a clear message (even if a document slipped past validation)', async () => {
    await server();
    const doc = {
      plugin: PLUGIN,
      hash: HASH,
      manifest: {} as never,
      server: {},
      functions: { c: { effect: 'read' as const, access: 'user' as const, steps: [{ let: 'r', request: { campus: 'portal', url: '/x' } }], return: 'r' } },
    };
    const d = { cfg: s.deps.config.functions, storage: s.deps.storage, limiter: s.deps.limiter, fetch: s.deps.fn.fetch, now: s.deps.now, storeQuota: s.deps.config.limits.store };
    const err = await runFunction(d, doc, 'c', {}).catch((e) => e as HttpError);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).message).toBe("campus services are only available on the phone (requested 'portal')");
  });
});

