import { afterEach, describe, expect, test } from 'bun:test';

import { errorBody, generateBoxKeyPair, paths, toB64url } from '@pku-harness/cloud-protocol';

import { RateLimiter } from '../src/limits';
import { type TestServer, channelBody, json, makeServer, registerDevice, shareKeys, tokenFor } from './helpers';

let s: TestServer;
afterEach(() => s?.close());

describe('token bucket', () => {
  test('refills continuously and reports reset/retry', () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    const rate = { limit: 3, windowS: 60 };
    expect([rl.take('k', rate).ok, rl.take('k', rate).ok, rl.take('k', rate).ok]).toEqual([true, true, true]);
    const refused = rl.take('k', rate);
    expect(refused).toMatchObject({ ok: false, remaining: 0, retryAfterS: 20, resetS: 60 });
    now += 20_000;
    expect(rl.take('k', rate).ok).toBe(true);
    expect(rl.take('other', rate).ok).toBe(true);
    now += 120_000;
    rl.sweep();
    expect(rl.size).toBe(0);
  });
});

describe('HTTP rate limits', () => {
  test('per (device, plugin, service): 429 errorBody, Retry-After and RateLimit-* headers', async () => {
    s = await makeServer({ rates: { store: { limit: 3, windowS: 60 } } });
    const dev = await registerDevice(s);
    const notes = await tokenFor(s, dev, 'notes', ['store']);
    const todo = await tokenFor(s, dev, 'todo', ['store']);
    for (let i = 0; i < 3; i++) {
      const r = await s.request(paths.storeList(), { token: notes });
      expect(r.status).toBe(200);
      expect(r.headers.get('ratelimit-limit')).toBe('3');
      expect(r.headers.get('ratelimit-remaining')).toBe(String(2 - i));
      expect(r.headers.get('ratelimit-policy')).toBe('3;w=60');
    }
    const r = await s.request(paths.storeList(), { token: notes });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('20');
    expect(r.headers.get('ratelimit-remaining')).toBe('0');
    const body = errorBody.parse(await r.json());
    expect(body.error).toEqual({ code: 'rate_limited', message: 'rate limit exceeded', retryAfterS: 20 });
    // another plugin of the same device has its own bucket
    expect((await s.request(paths.storeList(), { token: todo })).status).toBe(200);
    s.clock.advance(20_000);
    expect((await s.request(paths.storeList(), { token: notes })).status).toBe(200);
  });

  test('per IP: global bucket and joins per minute', async () => {
    s = await makeServer({ rates: { ip: { limit: 5, windowS: 60 }, joins: { limit: 2, windowS: 60 } } });
    for (let i = 0; i < 5; i++) expect((await s.request(paths.meta(), { headers: { 'x-forwarded-for': '1.1.1.1' } })).status).toBe(200);
    expect((await s.request(paths.meta(), { headers: { 'x-forwarded-for': '1.1.1.1' } })).status).toBe(429);
    // the last X-Forwarded-For hop (the one our proxy appended) is the client
    expect((await s.request(paths.meta(), { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } })).status).toBe(200);

    const dev = await registerDevice(s, '3.3.3.3');
    const token = await tokenFor(s, dev, 'card-share', ['channels']);
    const keys = shareKeys();
    const { id } = await json<{ id: string }>(await s.request(paths.channels(), { method: 'POST', token, json: channelBody(keys, { maxPeers: 5 }), headers: { 'x-forwarded-for': '3.3.3.3' } }));
    const join = () =>
      s.request(paths.join(id), { method: 'POST', json: { authKey: toB64url(keys.authKey), peerPub: toB64url(generateBoxKeyPair().publicKey) }, headers: { 'x-forwarded-for': '4.4.4.4' } });
    expect((await join()).status).toBe(200);
    expect((await join()).status).toBe(200);
    const third = await join();
    expect(third.status).toBe(429);
    expect(errorBody.parse(await third.json()).error.retryAfterS).toBe(30);
  });

  test('device registration is capped per IP', async () => {
    s = await makeServer({ rates: { register: { limit: 1, windowS: 3600 } } });
    await registerDevice(s, '5.5.5.5');
    await expect(registerDevice(s, '5.5.5.5')).rejects.toThrow('429');
    await registerDevice(s, '6.6.6.6');
  });
});
