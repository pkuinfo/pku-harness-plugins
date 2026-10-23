import { afterEach, describe, expect, test } from 'bun:test';

import {
  DEFAULT_LIMITS,
  channelInfoResponse,
  errorBody,
  generateBoxKeyPair,
  joinResponse,
  mailboxListResponse,
  open,
  paths,
  seal,
  toB64url,
} from '@pku-harness/cloud-protocol';

import { type TestServer, channelBody, json, makeServer, registerDevice, shareKeys, tokenFor } from './helpers';

let s: TestServer;
afterEach(() => s?.close());

const code = async (r: Response) => errorBody.parse(await r.json()).error.code;

async function setup(extra: Record<string, unknown> = {}, opts: Parameters<typeof makeServer>[0] = {}) {
  s = await makeServer(opts);
  const dev = await registerDevice(s);
  const token = await tokenFor(s, dev, 'card-share', ['channels']);
  const keys = shareKeys();
  const r = await s.request(paths.channels(), { method: 'POST', token, json: channelBody(keys, extra) });
  expect(r.status).toBe(200);
  const { id, expiresAt } = await json<{ id: string; expiresAt: number }>(r);
  const join = (authKey = keys.authKey, ip = '10.0.0.9') =>
    s.request(paths.join(id), { method: 'POST', json: { authKey: toB64url(authKey), peerPub: toB64url(generateBoxKeyPair().publicKey) }, headers: { 'x-forwarded-for': ip } });
  return { dev, token, keys, id, expiresAt, join };
}

describe('channels over HTTP', () => {
  test('create validates ttl, maxPeers and page; quota of open channels', async () => {
    const { token, keys } = await setup({}, { limits: { ...DEFAULT_LIMITS, channels: { ...DEFAULT_LIMITS.channels, maxOpen: 2 } } });
    const post = (extra: Record<string, unknown>) => s.request(paths.channels(), { method: 'POST', token, json: channelBody(keys, extra) });
    expect((await post({ ttlS: 59 })).status).toBe(400);
    expect((await post({ ttlS: 86_401 })).status).toBe(400);
    expect((await post({ maxPeers: 6 })).status).toBe(400);
    expect((await post({ page: 'nope' })).status).toBe(400);
    expect((await post({ page: 'view' })).status).toBe(200);
    const third = await post({});
    expect(third.status).toBe(403);
    expect(await code(third)).toBe('quota');
  });

  test('public info shows sealed meta the viewer can open', async () => {
    const { id, keys, expiresAt } = await setup();
    const info = channelInfoResponse.parse(await (await s.request(paths.publicChannel(id))).json());
    expect(info).toMatchObject({ status: 'open', expiresAt, ownerOnline: false, chanPub: toB64url(keys.chan.publicKey) });
    expect(open(keys.encKey, info.meta)).toEqual({ nameHint: '王_明', pinRequired: false });
    expect((await s.request(paths.publicChannel('AAAAAAAAAAAAAAAAAAAAAA'))).status).toBe(404);
  });

  test('join claims the seat; second joiner gets 409; kick frees it (via owner ws, see ws tests)', async () => {
    const { join } = await setup();
    const first = await join();
    expect(first.status).toBe(200);
    const j = joinResponse.parse(await first.json());
    expect(j.peerToken.startsWith('p1.')).toBe(true);
    const second = await join();
    expect(second.status).toBe(409);
    expect(await code(second)).toBe('conflict');
  });

  test('5 wrong keys lock the channel', async () => {
    const { id, join } = await setup();
    for (let i = 0; i < 4; i++) {
      const r = await join(new Uint8Array(32).fill(i + 1));
      expect(r.status).toBe(403);
      expect(await code(r)).toBe('forbidden');
    }
    expect((await join(new Uint8Array(32).fill(9))).status).toBe(403);
    const info = channelInfoResponse.parse(await (await s.request(paths.publicChannel(id))).json());
    expect(info.status).toBe('closed');
    // even the right key can't join a locked channel
    expect(await code(await join())).toBe('gone');
    expect(s.log.lines.some((l) => l.includes('channel_locked'))).toBe(true);
  });

  test('extend and close are owner-only; closed channels say so, then GC removes them', async () => {
    const { id, token, join } = await setup({}, { closedRetentionMs: 60_000 });
    const other = await registerDevice(s);
    const otherToken = await tokenFor(s, other, 'card-share', ['channels']);
    const samePluginOtherDevice = await s.request(paths.channel(id), { method: 'PATCH', token: otherToken, json: { ttlS: 600 } });
    expect(samePluginOtherDevice.status).toBe(403);
    const dev2Token = await tokenFor(s, (await registerDevice(s)), 'wallet', ['channels']);
    expect((await s.request(paths.channel(id), { method: 'DELETE', token: dev2Token })).status).toBe(403);

    s.clock.advance(10_000);
    const ext = await s.request(paths.channel(id), { method: 'PATCH', token, json: { ttlS: 999_999 } });
    expect(ext.status).toBe(200);
    expect(await ext.json()).toEqual({ expiresAt: s.clock.now + 86_400_000 });

    expect(await json(await s.request(paths.channel(id), { method: 'DELETE', token }))).toEqual({ ok: true });
    expect((await s.request(paths.channel(id), { method: 'DELETE', token })).status).toBe(200);
    expect(channelInfoResponse.parse(await (await s.request(paths.publicChannel(id))).json()).status).toBe('closed');
    expect(await code(await join())).toBe('gone');
    expect(await code(await s.request(paths.channel(id), { method: 'PATCH', token, json: { ttlS: 600 } }))).toBe('gone');

    s.clock.advance(60_001);
    await s.deps.hub.gc();
    expect((await s.request(paths.publicChannel(id))).status).toBe(404);
  });

  test('expiry: info says expired before GC; GC marks it; tokens stop working', async () => {
    const { id, join, expiresAt } = await setup({ ttlS: 60 });
    const j = joinResponse.parse(await (await join()).json());
    s.clock.now = expiresAt + 1;
    expect(channelInfoResponse.parse(await (await s.request(paths.publicChannel(id))).json()).status).toBe('expired');
    expect(await code(await s.request(paths.peerMailbox(id), { token: j.peerToken }))).toBe('gone');
    expect((await s.deps.hub.gc()).expired).toBe(1);
    expect((await s.deps.storage.getChannel(id))?.status).toBe('expired');
  });

  test('mailbox: owner puts sealed slots, peers read them; quotas; slots never outlive the channel', async () => {
    const { id, token, join, keys, expiresAt } = await setup({}, { limits: { ...DEFAULT_LIMITS, channels: { ...DEFAULT_LIMITS.channels, mailboxSlots: 2 } } });
    const env = seal(keys.encKey, { code: 'sealed' });
    const put = (slot: string, ttlS = 60) => s.request(paths.channelMailboxSlot(id, slot), { method: 'PUT', token, json: { env, ttlS } });
    expect((await put('t1')).status).toBe(200);
    expect((await put('t2', 999_999)).status).toBe(200);
    expect(await code(await put('t3'))).toBe('quota');
    expect((await put('t1')).status).toBe(200); // replace is fine

    // no peer token → unauthorized
    expect((await s.request(paths.peerMailbox(id))).status).toBe(401);
    const j = joinResponse.parse(await (await join()).json());
    const list = mailboxListResponse.parse(await (await s.request(paths.peerMailbox(id), { token: j.peerToken })).json());
    expect(list.items.map((i) => i.slot)).toEqual(['t1', 't2']);
    expect(list.items[1]!.expiresAt).toBe(expiresAt);
    // query-string token works too (EventSource-style clients)
    expect((await s.request(`${paths.peerMailbox(id)}?t=${j.peerToken}`)).status).toBe(200);

    await s.request(paths.channelMailboxSlot(id, 't1'), { method: 'DELETE', token });
    expect(mailboxListResponse.parse(await (await s.request(paths.peerMailbox(id), { token: j.peerToken })).json()).items.length).toBe(1);
    await s.request(paths.channelMailbox(id), { method: 'DELETE', token });
    expect(mailboxListResponse.parse(await (await s.request(paths.peerMailbox(id), { token: j.peerToken })).json()).items).toEqual([]);
  });

  test('peer token for one channel is useless on another', async () => {
    const a = await setup();
    const ja = joinResponse.parse(await (await a.join()).json());
    const keys = shareKeys();
    const b = await json<{ id: string }>(await s.request(paths.channels(), { method: 'POST', token: a.token, json: channelBody(keys) }));
    expect((await s.request(paths.peerMailbox(b.id), { token: ja.peerToken })).status).toBe(401);
  });

  test('SSE fallback: hello on connect, POST /send rejects when owner offline', async () => {
    const { id, join } = await setup();
    const j = joinResponse.parse(await (await join()).json());
    const ac = new AbortController();
    const r = await s.request(paths.peerEvents(id, j.peerToken), { signal: ac.signal });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const reader = r.body!.getReader();
    let text = '';
    while (!text.includes('"hello"')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`"peerId":"${j.peerId}"`);
    expect(s.deps.hub.peerOnline(id, j.peerId)).toBe(true);
    const send = await s.request(paths.peerSend(id), { method: 'POST', token: j.peerToken, json: { t: 'msg', env: seal(new Uint8Array(32), 'x') } });
    expect(send.status).toBe(409);
    await reader.cancel();
    ac.abort();
    expect(s.deps.hub.peerOnline(id, j.peerId)).toBe(false);
  });
});
