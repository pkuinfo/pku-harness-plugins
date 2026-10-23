import { describe, expect, test } from 'bun:test';

import { toB64url } from './bytes';
import { deriveShareKeys, generateBoxKeyPair, joinHash, seal } from './crypto';
import {
  DEFAULT_LIMITS,
  channelInfoResponse,
  createChannelRequest,
  envelopeSchema,
  errorBody,
  joinRequest,
  metaResponse,
  ownerInFrame,
  ownerOutFrame,
  paths,
  peerInFrame,
  peerOutFrame,
  registerDeviceRequest,
  storeKeySchema,
} from './schemas';

const key32 = toB64url(new Uint8Array(32).fill(9));
const env = seal(new Uint8Array(32), { hello: 1 });

describe('wire schemas', () => {
  test('meta', () => {
    const meta = {
      protocol: 1,
      services: ['store', 'channels'],
      limits: DEFAULT_LIMITS,
      pow: { difficulty: 16, salt: '2026-10' },
      pages: [{ plugin: 'card-share', page: 'view' }],
      functions: [],
      operator: { name: 'pkuinfo', contact: 'https://github.com/pkuinfo', privacyURL: 'https://example.org/privacy' },
      future: 'ignored',
    };
    const parsed = metaResponse.parse(meta);
    expect('future' in parsed).toBe(false);
    expect(metaResponse.safeParse({ ...meta, protocol: 2 }).success).toBe(false);
  });
  test('envelope', () => {
    expect(envelopeSchema.safeParse(env).success).toBe(true);
    expect(envelopeSchema.safeParse({ ...env, v: 2 }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...env, n: 'AAAA' }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...env, c: 'AA' }).success).toBe(false);
  });
  test('device + channel requests', () => {
    expect(registerDeviceRequest.safeParse({ signPub: key32, boxPub: key32, pow: { salt: 's', nonce: '42' } }).success).toBe(true);
    expect(registerDeviceRequest.safeParse({ signPub: key32.slice(1), boxPub: key32, pow: { salt: 's', nonce: '42' } }).success).toBe(false);
    const { authKey } = deriveShareKeys(new Uint8Array(32));
    const req = createChannelRequest.parse({ ttlS: 900, joinHash: joinHash(authKey), meta: env, chanPub: toB64url(generateBoxKeyPair().publicKey), page: 'view' });
    expect(req.maxPeers).toBe(1);
    expect(joinRequest.safeParse({ authKey: toB64url(authKey), peerPub: key32 }).success).toBe(true);
    expect(channelInfoResponse.safeParse({ status: 'open', meta: env, chanPub: key32, expiresAt: 1, ownerOnline: true }).success).toBe(true);
  });
  test('owner and peer frames', () => {
    for (const f of [
      { t: 'hello', id: 'chan_12345', expiresAt: 1, peers: [] },
      { t: 'join', peerId: 'p_1234', peerPub: key32, at: 5 },
      { t: 'leave', peerId: 'p_1234', at: 6 },
      { t: 'peer', peerId: 'p_1234', online: false, at: 7 },
      { t: 'msg', peerId: 'p_1234', env },
      { t: 'closed', reason: 'expired' },
      { t: 'error', code: 'rate_limited', message: 'slow down' },
    ])
      expect(ownerInFrame.safeParse(f).success).toBe(true);
    expect(ownerOutFrame.safeParse({ t: 'msg', to: 'p_1234', env }).success).toBe(true);
    expect(ownerOutFrame.safeParse({ t: 'msg', to: '*', env }).success).toBe(false);
    expect(ownerOutFrame.safeParse({ t: 'kick', peerId: 'p_1234' }).success).toBe(true);
    expect(peerInFrame.safeParse({ t: 'closed', reason: 'kicked' }).success).toBe(true);
    expect(peerInFrame.safeParse({ t: 'extended', expiresAt: 10 }).success).toBe(true);
    expect(peerInFrame.safeParse({ t: 'hello', peerId: 'p_1234', ownerOnline: false, expiresAt: 9 }).success).toBe(true);
    expect(peerOutFrame.safeParse({ t: 'msg', env }).success).toBe(true);
    expect(peerOutFrame.safeParse({ t: 'nope' }).success).toBe(false);
  });
  test('error body', () => {
    expect(errorBody.safeParse({ error: { code: 'rate_limited', message: 'x', retryAfterS: 3 } }).success).toBe(true);
    expect(errorBody.safeParse({ error: { code: 'teapot', message: 'x' } }).success).toBe(false);
  });
  test('store keys and paths', () => {
    expect(storeKeySchema.safeParse('shares/2026-10/a.b').success).toBe(true);
    expect(storeKeySchema.safeParse('a/../b').success).toBe(false);
    expect(storeKeySchema.safeParse('a b').success).toBe(false);
    expect(paths.storeKey('a/b:c')).toBe('/v1/store/a/b%3Ac');
    expect(paths.peerWs('chan_12345', 'a b')).toBe('/v1/c/chan_12345/ws?t=a%20b');
  });
});
