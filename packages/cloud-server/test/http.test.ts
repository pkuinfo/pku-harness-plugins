import { afterEach, describe, expect, test } from 'bun:test';

import { AUTH_MAX_SKEW_MS, errorBody, metaResponse, paths, signAuthChallenge, solvePow, toB64url, verifyPow } from '@pku-harness/cloud-protocol';

import { type TestServer, challenge, channelBody, json, makeServer, registerDevice, shareKeys, tokenFor } from './helpers';

let s: TestServer;
afterEach(() => s?.close());

describe('meta', () => {
  test('matches the protocol schema and lists served pages', async () => {
    s = await makeServer();
    const r = await s.request(paths.meta());
    expect(r.status).toBe(200);
    const meta = metaResponse.parse(await r.json());
    expect(meta.services).toEqual(['store', 'channels']);
    expect(meta.pow.difficulty).toBe(4);
    expect(meta.pages).toEqual([{ plugin: 'card-share', page: 'view' }]);
    expect(meta.limits.push).toBeUndefined();
  });

  test('pow salt rotates; the previous salt stays valid for one period', async () => {
    s = await makeServer({ powRotateS: 60 });
    const first = metaResponse.parse(await (await s.request(paths.meta())).json()).pow.salt;
    const keys = { signPub: 'a', boxPub: 'b' };
    const { nonce } = await solvePow({ salt: first, ...keys }, 4);
    s.clock.advance(61_000);
    const second = metaResponse.parse(await (await s.request(paths.meta())).json()).pow.salt;
    expect(second).not.toBe(first);
    expect(await s.deps.pow.check({ salt: first, nonce, ...keys }, s.clock.now)).toBe(true);
    s.clock.advance(61_000);
    expect(await s.deps.pow.check({ salt: first, nonce, ...keys }, s.clock.now)).toBe(false);
  });
});

describe('devices', () => {
  test('register with PoW; idempotent per signing key; bad PoW refused', async () => {
    s = await makeServer({ powDifficulty: 12 });
    const dev = await registerDevice(s);
    expect(dev.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const meta = metaResponse.parse(await (await s.request(paths.meta())).json());
    const signPub = toB64url(dev.identity.sign.publicKey);
    const boxPub = toB64url(dev.identity.box.publicKey);
    // find a nonce that does NOT solve difficulty 12
    let bad = 0;
    while (verifyPow({ salt: meta.pow.salt, signPub, boxPub }, String(bad), 12)) bad++;
    const r = await s.request(paths.devices(), { method: 'POST', json: { signPub, boxPub, pow: { salt: meta.pow.salt, nonce: String(bad) } } });
    expect(r.status).toBe(400);
    expect(errorBody.parse(await r.json()).error.code).toBe('pow_invalid');
    const unknownSalt = await s.request(paths.devices(), { method: 'POST', json: { signPub, boxPub, pow: { salt: 'nope', nonce: '1' } } });
    expect(errorBody.parse(await unknownSalt.json()).error.code).toBe('pow_invalid');
  });

  test('DELETE /v1/devices/me wipes store, channels and revokes tokens', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const token = await tokenFor(s, dev, 'notes');
    await s.request(paths.storeKey('a'), { method: 'PUT', token, json: { value: 1 } });
    const ch = await json<{ id: string }>(await s.request(paths.channels(), { method: 'POST', token, json: channelBody(shareKeys()) }));
    const del = await s.request(paths.deviceMe(), { method: 'DELETE', token });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    expect((await s.request(paths.storeKey('a'), { token })).status).toBe(401);
    expect((await s.request(paths.publicChannel(ch.id))).status).toBe(404);
    expect(await s.deps.storage.getDevice(dev.id)).toBeUndefined();
  });
});

describe('auth token', () => {
  test('issues a token limited to offered services', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const r = await s.request(paths.authToken(), { method: 'POST', json: challenge(s, dev, 'card-share', ['channels', 'push']) });
    expect(r.status).toBe(200);
    const { token, expiresAt } = await json<{ token: string; expiresAt: number }>(r);
    expect(expiresAt).toBe(s.clock.now + 600_000);
    expect(s.deps.tokens.verifyDevice(token, s.clock.now)?.svc).toEqual(['channels']);
    const onlyPush = await s.request(paths.authToken(), { method: 'POST', json: challenge(s, dev, 'card-share', ['push']) });
    expect(onlyPush.status).toBe(501);
  });

  test('nonce replay is rejected', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const body = challenge(s, dev, 'card-share', ['channels']);
    expect((await s.request(paths.authToken(), { method: 'POST', json: body })).status).toBe(200);
    const again = await s.request(paths.authToken(), { method: 'POST', json: body });
    expect(again.status).toBe(401);
    expect(errorBody.parse(await again.json()).error.message).toBe('nonce already used');
  });

  test('wrong aud, stale ts, bad signature, unknown device are rejected', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const other = await registerDevice(s);
    const post = (json: unknown) => s.request(paths.authToken(), { method: 'POST', json });
    const wrongAud = await post(challenge(s, dev, 'card-share', ['channels'], 'https://evil.example'));
    expect(wrongAud.status).toBe(401);
    expect(errorBody.parse(await wrongAud.json()).error.message).toBe('wrong audience');
    const stale = signAuthChallenge(
      { aud: 'http://localhost:8787', deviceId: dev.id, plugin: 'card-share', services: ['channels'], now: s.clock.now - AUTH_MAX_SKEW_MS - 1000 },
      dev.identity.sign.secretKey,
    );
    expect(errorBody.parse(await (await post(stale)).json()).error.message).toBe('timestamp outside the allowed skew');
    // signed by another device's key
    const forged = signAuthChallenge({ aud: 'http://localhost:8787', deviceId: dev.id, plugin: 'card-share', services: ['channels'], now: s.clock.now }, other.identity.sign.secretKey);
    expect(errorBody.parse(await (await post(forged)).json()).error.message).toBe('bad signature');
    const ghost = { ...challenge(s, dev, 'card-share', ['channels']), deviceId: 'AAAAAAAAAAAAAAAAAAAAAA' };
    expect((await post(ghost)).status).toBe(401);
  });

  test('tokens expire after 10 minutes and are bound to (device, plugin, services)', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const storeOnly = await tokenFor(s, dev, 'notes', ['store']);
    const create = await s.request(paths.channels(), { method: 'POST', token: storeOnly, json: channelBody(shareKeys()) });
    expect(create.status).toBe(403);
    expect(errorBody.parse(await create.json()).error.code).toBe('forbidden');
    expect((await s.request(paths.storeList(), { token: storeOnly })).status).toBe(200);
    s.clock.advance(600_001);
    expect((await s.request(paths.storeList(), { token: storeOnly })).status).toBe(401);
    expect((await s.request(paths.storeList(), { token: `${storeOnly}x` })).status).toBe(401);
    expect((await s.request(paths.storeList())).status).toBe(401);
  });
});

describe('errors', () => {
  test('stage-6 endpoints return 501 errorBody; unknown paths 404; bad JSON 400; big bodies 413', async () => {
    s = await makeServer({ maxBodyBytes: 1024 });
    for (const [method, path] of [
      ['POST', paths.fn('card-share', 'x')],
      ['POST', paths.pushTokens()],
      ['POST', paths.pushSchedule()],
      ['DELETE', paths.pushSchedule()],
    ] as const) {
      const r = await s.request(path, { method });
      expect(r.status).toBe(501);
      expect(errorBody.parse(await r.json()).error.code).toBe('unsupported');
    }
    const nf = await s.request('/v1/nope');
    expect(nf.status).toBe(404);
    expect(errorBody.parse(await nf.json()).error.code).toBe('not_found');
    const bad = await s.request(paths.devices(), { method: 'POST', body: '{"signPub": oops', headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(400);
    expect(errorBody.parse(await bad.json()).error.message).toBe('body must be JSON');
    const big = await s.request(paths.devices(), { method: 'POST', json: { pad: 'x'.repeat(2000) } });
    expect(big.status).toBe(413);
    expect(errorBody.parse(await big.json()).error.code).toBe('payload_too_large');
  });
});
