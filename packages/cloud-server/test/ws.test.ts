/**
 * End-to-end over a real socket: Bun.serve on an ephemeral port, real WebSocket and SSE
 * clients, the protocol's own crypto on both ends. Also proves the server never persists or
 * logs plaintext: the SQLite file (+ WAL) and every captured log line are searched for the
 * plaintexts that went through it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type Envelope,
  type OwnerInFrame,
  type PeerInFrame,
  channelInfoResponse,
  errorBody,
  generateBoxKeyPair,
  joinResponse,
  open,
  ownerInFrame,
  ownerPeerKey,
  paths,
  peerInFrame,
  seal,
  toB64url,
  viewerPeerKey,
  fromB64url,
} from '@pku-harness/cloud-protocol';

import { serve } from '../src/index';
import { type TestServer, channelBody, json, makeServer, registerDevice, shareKeys, tokenFor } from './helpers';

const PAYCODE = 'PAYCODE-6229-8812-0042-7777';
const VIEWER_SECRET = 'VIEWER-PIN-314159';
const NAME_HINT = '王_明';

/** Collects frames from a WebSocket or SSE stream; `next()` waits for the next match. */
class Inbox<F extends { t: string }> {
  private frames: F[] = [];
  private waiters: { pred: (f: F) => boolean; resolve: (f: F) => void }[] = [];
  closed?: { code: number };
  push(f: F) {
    const i = this.waiters.findIndex((w) => w.pred(f));
    if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(f);
    else this.frames.push(f);
  }
  next<T extends F['t']>(t: T, timeoutMs = 2000): Promise<Extract<F, { t: T }>> {
    const pred = (f: F) => f.t === t;
    const i = this.frames.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.frames.splice(i, 1)[0] as Extract<F, { t: T }>);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: resolve as (f: F) => void };
      this.waiters.push(w);
      setTimeout(() => {
        const k = this.waiters.indexOf(w);
        if (k >= 0) {
          this.waiters.splice(k, 1);
          reject(new Error(`timeout waiting for ${t}`));
        }
      }, timeoutMs);
    });
  }
}

function connect<F extends { t: string }>(url: string, schema: { parse(x: unknown): F }, headers?: Record<string, string>) {
  const ws = new WebSocket(url, headers ? ({ headers } as unknown as string[]) : undefined);
  const inbox = new Inbox<F>();
  const closed = new Promise<number>((r) => ws.addEventListener('close', (e) => r(e.code)));
  ws.addEventListener('message', (e) => inbox.push(schema.parse(JSON.parse(String(e.data)))));
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
  return { ws, inbox, opened, closed, send: (f: unknown) => ws.send(JSON.stringify(f)) };
}

let s: TestServer;
let server: ReturnType<typeof serve>;
let base: string;
let wsBase: string;
let dbPath: string;
const consoleLines: string[] = [];
const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };

beforeAll(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const)
    console[k] = (...a: unknown[]) => {
      consoleLines.push(a.map(String).join(' '));
    };
  dbPath = join(mkdtempSync(join(tmpdir(), 'cloud-db-')), 'cloud.db');
  s = await makeServer({ dbPath, rates: { register: { limit: 100, windowS: 60 } } });
  server = serve(s, { port: 0, hostname: '127.0.0.1' });
  base = `http://127.0.0.1:${server.port}`;
  wsBase = `ws://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
  s?.close();
  Object.assign(console, orig);
});

const http = (path: string, init: RequestInit & { json?: unknown; token?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  return fetch(base + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
};

describe('live channel over WebSocket', () => {
  test('register → token → channel → join → frames both ways → claim → kick → reconnect → extend → close', async () => {
    const dev = await registerDevice(s);
    const token = await tokenFor(s, dev, 'card-share', ['channels']);
    const keys = shareKeys();
    const { id } = await json<{ id: string }>(await http(paths.channels(), { method: 'POST', token, json: channelBody(keys, { ttlS: 600 }) }));

    // the owner socket needs the owner's token
    expect((await http(paths.channelWs(id), { headers: { upgrade: 'websocket' } })).status).toBe(401);
    expect((await http(paths.channelWs(id), { token })).status).toBe(426);

    let owner = connect<OwnerInFrame>(wsBase + paths.channelWs(id), ownerInFrame, { authorization: `Bearer ${token}` });
    await owner.opened;
    expect(await owner.inbox.next('hello')).toMatchObject({ id, peers: [] });

    // viewer: info → open meta → join
    const info = channelInfoResponse.parse(await (await http(paths.publicChannel(id))).json());
    expect(info.ownerOnline).toBe(true);
    expect(open<{ nameHint: string }>(keys.encKey, info.meta).nameHint).toBe(NAME_HINT);
    const viewer = generateBoxKeyPair();
    const jr = await http(paths.join(id), { method: 'POST', json: { authKey: toB64url(keys.authKey), peerPub: toB64url(viewer.publicKey) } });
    expect(jr.status).toBe(200);
    const j = joinResponse.parse(await jr.json());
    const joined = await owner.inbox.next('join');
    expect(joined).toMatchObject({ peerId: j.peerId, peerPub: toB64url(viewer.publicKey) });

    const peer = connect<PeerInFrame>(wsBase + paths.peerWs(id, j.peerToken), peerInFrame);
    await peer.opened;
    expect(await peer.inbox.next('hello')).toMatchObject({ peerId: j.peerId, ownerOnline: true });
    expect(await owner.inbox.next('peer')).toMatchObject({ peerId: j.peerId, online: true });

    // owner → peer: a sealed payment code
    const kOwner = ownerPeerKey(keys.chan.secretKey, keys.chan.publicKey, fromB64url(joined.peerPub), keys.encKey);
    const kViewer = viewerPeerKey(viewer.secretKey, viewer.publicKey, fromB64url(info.chanPub), keys.encKey);
    owner.send({ t: 'msg', to: j.peerId, env: seal(kOwner, { code: PAYCODE, seq: 1 }) });
    const got = await peer.inbox.next('msg');
    expect(open(kViewer, got.env)).toEqual({ code: PAYCODE, seq: 1 });

    // peer → owner: a gate answer
    peer.send({ t: 'msg', env: seal(kViewer, { gate: 'pin', pin: VIEWER_SECRET }) });
    const back = await owner.inbox.next('msg');
    expect(back.peerId).toBe(j.peerId);
    expect(open(kOwner, back.env)).toEqual({ gate: 'pin', pin: VIEWER_SECRET });

    // ping/pong, malformed and oversized frames
    owner.send({ t: 'ping' });
    peer.send({ t: 'ping' });
    expect((await owner.inbox.next('pong')).at).toBeGreaterThan(0);
    expect((await peer.inbox.next('pong')).at).toBeGreaterThan(0);
    owner.ws.send('not json');
    expect(await owner.inbox.next('error')).toMatchObject({ code: 'bad_request' });
    const huge: Envelope = { v: 1, n: toB64url(new Uint8Array(24)), c: 'A'.repeat(6000) };
    peer.send({ t: 'msg', env: huge });
    expect(await peer.inbox.next('error')).toMatchObject({ code: 'payload_too_large' });
    owner.send({ t: 'msg', to: 'nobody', env: seal(kOwner, 1) });
    expect(await owner.inbox.next('error')).toMatchObject({ code: 'not_found' });

    // the seat is claimed: a forwarded link is useless
    const second = await http(paths.join(id), { method: 'POST', json: { authKey: toB64url(keys.authKey), peerPub: toB64url(generateBoxKeyPair().publicKey) } });
    expect(second.status).toBe(409);
    expect(errorBody.parse(await second.json()).error.code).toBe('conflict');

    // 重置查看者: kick frees the seat and revokes the peer token
    owner.send({ t: 'kick', peerId: j.peerId });
    expect(await peer.inbox.next('closed')).toEqual({ t: 'closed', reason: 'kicked' });
    expect(await peer.closed).toBe(4003);
    expect(await owner.inbox.next('leave')).toMatchObject({ peerId: j.peerId });
    expect((await http(paths.peerMailbox(id), { token: j.peerToken })).status).toBe(403);
    const viewer2 = generateBoxKeyPair();
    const j2 = joinResponse.parse(
      await (await http(paths.join(id), { method: 'POST', json: { authKey: toB64url(keys.authKey), peerPub: toB64url(viewer2.publicKey) } })).json(),
    );
    await owner.inbox.next('join');
    const peer2 = connect<PeerInFrame>(wsBase + paths.peerWs(id, j2.peerToken), peerInFrame);
    await peer2.opened;
    await peer2.inbox.next('hello');
    await owner.inbox.next('peer');

    // owner drops and comes back (app restart): peers see presence, hello lists the seat
    owner.ws.close();
    expect(await peer2.inbox.next('owner')).toEqual({ t: 'owner', online: false });
    owner = connect<OwnerInFrame>(`${wsBase}${paths.channelWs(id)}?t=${token}`, ownerInFrame);
    await owner.opened;
    const hello = await owner.inbox.next('hello');
    expect(hello.peers).toEqual([{ peerId: j2.peerId, peerPub: toB64url(viewer2.publicKey), joinedAt: expect.any(Number), online: true }]);
    expect(await peer2.inbox.next('owner')).toEqual({ t: 'owner', online: true });

    // extend reaches peers
    const ext = await json<{ expiresAt: number }>(await http(paths.channel(id), { method: 'PATCH', token, json: { ttlS: 1200 } }));
    expect(await peer2.inbox.next('extended')).toEqual({ t: 'extended', expiresAt: ext.expiresAt });

    // close: everyone is told, sockets close, nothing can join
    expect((await http(paths.channel(id), { method: 'DELETE', token })).status).toBe(200);
    expect(await owner.inbox.next('closed')).toEqual({ t: 'closed', reason: 'owner' });
    expect(await peer2.inbox.next('closed')).toEqual({ t: 'closed', reason: 'owner' });
    expect(await owner.closed).toBe(4010);
    expect(await peer2.closed).toBe(4010);
    expect(s.deps.hub.stats).toEqual({ owners: 0, peers: 0 });
    expect((await http(paths.peerWs(id, j2.peerToken), { headers: { upgrade: 'websocket' } })).status).toBe(410);
  });

  test('SSE peer + POST /send, then TTL expiry closes everything via GC', async () => {
    const dev = await registerDevice(s);
    const token = await tokenFor(s, dev, 'card-share', ['channels']);
    const keys = shareKeys();
    const { id, expiresAt } = await json<{ id: string; expiresAt: number }>(await http(paths.channels(), { method: 'POST', token, json: channelBody(keys, { ttlS: 60 }) }));
    const owner = connect<OwnerInFrame>(wsBase + paths.channelWs(id), ownerInFrame, { authorization: `Bearer ${token}` });
    await owner.opened;
    await owner.inbox.next('hello');

    const viewer = generateBoxKeyPair();
    const j = joinResponse.parse(await (await http(paths.join(id), { method: 'POST', json: { authKey: toB64url(keys.authKey), peerPub: toB64url(viewer.publicKey) } })).json());
    await owner.inbox.next('join');

    const sse = await fetch(base + paths.peerEvents(id, j.peerToken));
    expect(sse.status).toBe(200);
    const inbox = new Inbox<PeerInFrame>();
    const reader = sse.body!.getReader();
    const done = (async () => {
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += new TextDecoder().decode(value);
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of chunk.split('\n')) if (line.startsWith('data: ')) inbox.push(peerInFrame.parse(JSON.parse(line.slice(6))));
        }
      }
    })();
    expect(await inbox.next('hello')).toMatchObject({ peerId: j.peerId, ownerOnline: true });
    await owner.inbox.next('peer');

    const kOwner = ownerPeerKey(keys.chan.secretKey, keys.chan.publicKey, viewer.publicKey, keys.encKey);
    const kViewer = viewerPeerKey(viewer.secretKey, viewer.publicKey, keys.chan.publicKey, keys.encKey);
    owner.send({ t: 'msg', to: j.peerId, env: seal(kOwner, { code: PAYCODE, seq: 2 }) });
    expect(open(kViewer, (await inbox.next('msg')).env)).toEqual({ code: PAYCODE, seq: 2 });

    const sent = await http(paths.peerSend(id), { method: 'POST', token: j.peerToken, json: { t: 'msg', env: seal(kViewer, { want: true, pin: VIEWER_SECRET }) } });
    expect(sent.status).toBe(200);
    expect(open(kOwner, (await owner.inbox.next('msg')).env)).toEqual({ want: true, pin: VIEWER_SECRET });
    expect((await http(paths.peerSend(id), { method: 'POST', token: j.peerToken, json: { t: 'ping' } })).status).toBe(200);
    expect((await inbox.next('pong')).at).toBeGreaterThan(0);

    // TTL passes; the GC loop closes the channel and its connections
    s.clock.now = expiresAt + 1;
    expect((await s.deps.hub.gc()).expired).toBe(1);
    expect(await owner.inbox.next('closed')).toEqual({ t: 'closed', reason: 'expired' });
    expect(await inbox.next('closed')).toEqual({ t: 'closed', reason: 'expired' });
    expect(await owner.closed).toBe(4010);
    await done;
    expect(channelInfoResponse.parse(await (await http(paths.publicChannel(id))).json()).status).toBe('expired');
  });

  test('the database and logs never contain plaintext', async () => {
    // the main file and the WAL (recent pages may live only there)
    const files = [dbPath, `${dbPath}-wal`].filter(existsSync);
    expect(files.length).toBeGreaterThan(0);
    const blobs = files.map((f) => readFileSync(f));
    const logs = [...s.log.lines, ...consoleLines].join('\n');
    expect(s.log.lines.length).toBeGreaterThan(10);
    for (const secret of [PAYCODE, VIEWER_SECRET, NAME_HINT]) {
      const needle = Buffer.from(secret, 'utf8');
      for (const b of blobs) expect(b.includes(needle)).toBe(false);
      expect(logs.includes(secret)).toBe(false);
    }
    // sanity: the search would find what is really there (channel public keys are stored)
    expect(blobs.some((b) => b.includes(Buffer.from('card-share')))).toBe(true);
    // tokens and query strings never reach the logs either
    expect(logs).not.toMatch(/[dp]1\.[A-Za-z0-9_-]{20,}/);
    expect(logs).not.toContain('?t=');
  });
});
