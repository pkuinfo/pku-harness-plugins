/**
 * The viewer client against an in-memory relay, with real envelope crypto: the "owner" side
 * seals exactly as the host's channel client does (meta with encKey, frames with the per-peer
 * key), so a crypto or framing drift between app and viewers fails here.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildShareLink,
  deriveShareKeys,
  fromB64url,
  generateBoxKeyPair,
  generateShareSecret,
  joinHash,
  open,
  ownerPeerKey,
  parseShareLink,
  seal,
  toB64url,
} from '@pku-harness/cloud-protocol';

import { shareMetaOf } from './session';
import { flush } from './test/fakes';
import { ShareViewer, type ViewerState } from './viewer-client';

class FakeWS {
  static last: FakeWS | null = null;
  readyState = 0;
  sent: any[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
      this.push({ t: 'hello', peerId: 'peer0001', ownerOnline: true, expiresAt: Date.now() + 600_000 });
    });
  }
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.readyState = 3;
  }
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function relay(opts: { claimed?: boolean } = {}) {
  const k = generateShareSecret();
  const { authKey, encKey } = deriveShareKeys(k);
  const chan = generateBoxKeyPair();
  const id = 'chanAAAAAAAA';
  const meta = shareMetaOf({ ttlS: 600, capYuan: 50, pin: '2468', name: { full: '王小明', hidden: [1] } });
  let peerPub: Uint8Array | null = null;
  const fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace('http://relay.test', '');
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (path === `/v1/c/${id}` && (init?.method ?? 'GET') === 'GET')
      return json(200, { status: 'open', meta: seal(encKey, meta), chanPub: toB64url(chan.publicKey), expiresAt: Date.now() + 600_000, ownerOnline: true });
    if (path === `/v1/c/${id}/join`) {
      if (opts.claimed) return json(409, { error: { code: 'conflict', message: 'claimed' } });
      const body = JSON.parse(init!.body!);
      if (toB64url(new Uint8Array(fromB64url(body.authKey))) !== toB64url(authKey) || joinHash(fromB64url(body.authKey)) !== joinHash(authKey)) return json(403, { error: { code: 'forbidden', message: 'x' } });
      peerPub = fromB64url(body.peerPub);
      return json(200, { peerId: 'peer0001', peerToken: 'token-token-token-token', expiresAt: Date.now() + 600_000 });
    }
    return json(404, { error: { code: 'not_found', message: path } });
  }) as unknown as typeof globalThis.fetch;
  const peerKey = () => ownerPeerKey(chan.secretKey, chan.publicKey, peerPub!, encKey);
  return { link: buildShareLink('http://relay.test', id, k), fetch, peerKey };
}

function viewer(r: ReturnType<typeof relay>) {
  const states: ViewerState[] = [];
  const p = parseShareLink(r.link)!;
  const store = new Map<string, string>();
  const v = new ShareViewer({
    base: p.base!,
    channelId: p.channelId,
    k: p.k,
    fetch: r.fetch,
    WebSocket: FakeWS as never,
    store: { get: (k) => store.get(k), set: (k, val) => void store.set(k, val), delete: (k) => void store.delete(k) },
    onState: (s) => states.push(s),
  });
  return { v, states, store, last: () => states.at(-1)! };
}

describe('ShareViewer', () => {
  test('meta → gate → join → sealed gate answer → code → revoked', async () => {
    const r = relay();
    const { v, last, store } = viewer(r);
    await v.start();
    expect(last()).toMatchObject({ s: 'gate', need: ['name', 'pin'], meta: { nameHint: '王_明', capYuan: 50 } });
    await v.submitGate({ name: '小', pin: '2468' });
    await flush();
    const ws = FakeWS.last!;
    expect(ws.url).toBe('ws://relay.test/v1/c/chanAAAAAAAA/ws?t=token-token-token-token');
    const out = ws.sent.find((f) => f.t === 'msg');
    expect(open(r.peerKey(), out.env)).toEqual({ t: 'gate', name: '小', pin: '2468' });
    ws.push({ t: 'msg', env: seal(r.peerKey(), { t: 'gate_result', ok: true }) });
    await flush();
    expect(last().s).toBe('waiting');
    ws.push({ t: 'msg', env: seal(r.peerKey(), { t: 'code', code: 'C0DE-1', issuedAt: Date.now(), seq: 1, balance: 88, refreshS: 25 }) });
    await flush();
    expect(last()).toMatchObject({ s: 'live', code: 'C0DE-1', balance: 88 });
    expect(store.size).toBe(1);
    ws.push({ t: 'msg', env: seal(r.peerKey(), { t: 'revoked', reason: 'owner' }) });
    await flush();
    expect(last()).toEqual({ s: 'ended', reason: 'owner' });
    expect(store.size).toBe(0);
  });

  test('frames sealed with another key are dropped', async () => {
    const r = relay();
    const { v, last } = viewer(r);
    await v.start();
    await v.submitGate({ name: '小', pin: '2468' });
    await flush();
    FakeWS.last!.push({ t: 'msg', env: seal(new Uint8Array(32).fill(7), { t: 'code', code: 'EVIL', issuedAt: 1, seq: 1 }) });
    await flush();
    expect(last().s).toBe('gate');
  });

  test('a claimed link shows "taken"', async () => {
    const r = relay({ claimed: true });
    const { v, last } = viewer(r);
    await v.start();
    await v.submitGate({ name: '小', pin: '2468' });
    expect(last()).toEqual({ s: 'taken' });
  });

  test('a tampered key fails to open the meta', async () => {
    const r = relay();
    const p = parseShareLink(r.link)!;
    const states: ViewerState[] = [];
    const v = new ShareViewer({ base: p.base!, channelId: p.channelId, k: new Uint8Array(32).fill(1), fetch: r.fetch, onState: (s) => states.push(s) });
    await v.start();
    expect(states.at(-1)).toEqual({ s: 'error', message: 'bad_link' });
  });
});
