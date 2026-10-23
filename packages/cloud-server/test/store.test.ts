import { afterEach, describe, expect, test } from 'bun:test';

import { DEFAULT_LIMITS, errorBody, paths, seal, storeGetResponse, storeListResponse } from '@pku-harness/cloud-protocol';

import { type TestServer, json, makeServer, registerDevice, tokenFor } from './helpers';

let s: TestServer;
afterEach(() => s?.close());

const code = async (r: Response) => errorBody.parse(await r.json()).error.code;

describe('store', () => {
  test('CRUD with versions, ETag and list by prefix', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const token = await tokenFor(s, dev, 'notes', ['store']);
    const env = seal(new Uint8Array(32), { secret: 'x' });

    expect((await s.request(paths.storeKey('a/b'), { token })).status).toBe(404);
    const put = await s.request(paths.storeKey('a/b'), { method: 'PUT', token, json: { value: env } });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ version: 1 });
    expect(put.headers.get('etag')).toBe('"1"');

    const got = storeGetResponse.parse(await (await s.request(paths.storeKey('a/b'), { token })).json());
    expect(got).toMatchObject({ key: 'a/b', value: env, version: 1 });

    expect(await json(await s.request(paths.storeKey('a/b'), { method: 'PUT', token, json: { value: 2 } }))).toEqual({ version: 2 });
    await s.request(paths.storeKey('a/c'), { method: 'PUT', token, json: { value: 3 } });
    await s.request(paths.storeKey('z'), { method: 'PUT', token, json: { value: 4 } });

    const list = storeListResponse.parse(await (await s.request(paths.storeList('a/'), { token })).json());
    expect(list.items.map((i) => [i.key, i.version])).toEqual([
      ['a/b', 2],
      ['a/c', 1],
    ]);
    // LIKE wildcards in the prefix are literal
    expect(storeListResponse.parse(await (await s.request(paths.storeList('a_'), { token })).json()).items).toEqual([]);

    expect(await json(await s.request(paths.storeKey('a/b'), { method: 'DELETE', token }))).toEqual({ ok: true });
    expect((await s.request(paths.storeKey('a/b'), { token })).status).toBe(404);
    // deleting a missing key is fine
    expect((await s.request(paths.storeKey('a/b'), { method: 'DELETE', token })).status).toBe(200);
  });

  test('If-Match: create-only, compare-and-set, conflicts', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const token = await tokenFor(s, dev, 'notes', ['store']);
    const put = (v: unknown, ifMatch?: string) =>
      s.request(paths.storeKey('k'), { method: 'PUT', token, json: { value: v }, headers: ifMatch === undefined ? {} : { 'if-match': ifMatch } });

    expect((await put(1, '0')).status).toBe(200);
    const again = await put(1, '0');
    expect(again.status).toBe(409);
    expect(await code(again)).toBe('conflict');
    expect((await put(2, '"1"')).status).toBe(200);
    expect((await put(3, '1')).status).toBe(409);
    expect((await put(3, 'W/"2"')).status).toBe(200);
    expect((await put(3, 'abc')).status).toBe(400);
    const del = await s.request(paths.storeKey('k'), { method: 'DELETE', token, headers: { 'if-match': '1' } });
    expect(del.status).toBe(409);
    expect((await s.request(paths.storeKey('k'), { method: 'DELETE', token, headers: { 'if-match': '3' } })).status).toBe(200);
  });

  test('namespaces are isolated between plugins and between devices', async () => {
    s = await makeServer();
    const alice = await registerDevice(s);
    const bob = await registerDevice(s);
    const aliceNotes = await tokenFor(s, alice, 'notes', ['store']);
    const aliceTodo = await tokenFor(s, alice, 'todo', ['store']);
    const bobNotes = await tokenFor(s, bob, 'notes', ['store']);

    await s.request(paths.storeKey('shared'), { method: 'PUT', token: aliceNotes, json: { value: 'alice-notes' } });
    expect((await s.request(paths.storeKey('shared'), { token: aliceTodo })).status).toBe(404);
    expect((await s.request(paths.storeKey('shared'), { token: bobNotes })).status).toBe(404);
    expect(storeListResponse.parse(await (await s.request(paths.storeList(), { token: bobNotes })).json()).items).toEqual([]);

    // same key in another namespace starts at version 1 and doesn't touch the first
    expect(await json(await s.request(paths.storeKey('shared'), { method: 'PUT', token: bobNotes, json: { value: 'bob' } }))).toEqual({ version: 1 });
    await s.request(paths.storeKey('shared'), { method: 'DELETE', token: aliceTodo });
    const still = storeGetResponse.parse(await (await s.request(paths.storeKey('shared'), { token: aliceNotes })).json());
    expect(still.value).toBe('alice-notes');
  });

  test('ttl expires keys', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const token = await tokenFor(s, dev, 'notes', ['store']);
    await s.request(paths.storeKey('tmp'), { method: 'PUT', token, json: { value: 1, ttlS: 60 } });
    const got = storeGetResponse.parse(await (await s.request(paths.storeKey('tmp'), { token })).json());
    expect(got.expiresAt).toBe(s.clock.now + 60_000);
    s.clock.advance(60_001);
    expect((await s.request(paths.storeKey('tmp'), { token })).status).toBe(404);
    // an expired key counts as absent for If-Match: 0
    expect((await s.request(paths.storeKey('tmp'), { method: 'PUT', token, json: { value: 2 }, headers: { 'if-match': '0' } })).status).toBe(200);
  });

  test('quotas: value size, key count, total bytes', async () => {
    s = await makeServer({ limits: { ...DEFAULT_LIMITS, store: { maxBytes: 100, maxKeys: 2, maxValueBytes: 60 } } });
    const dev = await registerDevice(s);
    const token = await tokenFor(s, dev, 'notes', ['store']);
    const put = (k: string, v: unknown) => s.request(paths.storeKey(k), { method: 'PUT', token, json: { value: v } });
    expect((await put('big', 'x'.repeat(70))).status).toBe(413);
    expect((await put('a', 'x'.repeat(50))).status).toBe(200);
    const tooMuch = await put('b', 'x'.repeat(50));
    expect(tooMuch.status).toBe(403);
    expect(await code(tooMuch)).toBe('quota');
    expect((await put('b', 'x')).status).toBe(200);
    expect(await code(await put('c', 'x'))).toBe('quota');
    // replacing an existing key is measured without its old size
    expect((await put('a', 'y'.repeat(50))).status).toBe(200);
  });

  test('keys with dot segments or bad characters are rejected', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const token = await tokenFor(s, dev, 'notes', ['store']);
    expect((await s.request('/v1/store/a/../b', { token })).status).toBeOneOf([400, 404]);
    expect((await s.request('/v1/store/a%2F..%2Fb', { token })).status).toBe(400);
    expect((await s.request('/v1/store/sp%20ace', { token })).status).toBe(400);
  });
});
