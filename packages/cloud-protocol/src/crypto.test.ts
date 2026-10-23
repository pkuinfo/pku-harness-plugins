import { describe, expect, test } from 'bun:test';

import { fromB64url, fromUtf8, isB64url, toB64url, toHex, utf8 } from './bytes';
import {
  EnvelopeError,
  deriveShareKeys,
  generateBoxKeyPair,
  generateDeviceIdentity,
  generateShareSecret,
  hkdfSha256,
  joinHash,
  open,
  openBytes,
  ownerPeerKey,
  seal,
  sealBytes,
  sha256,
  sign,
  verify,
  viewerPeerKey,
} from './crypto';

/** Deterministic test RNG (never use outside tests). */
function counterRand(start = 1) {
  let n = start;
  return (len: number) => Uint8Array.from({ length: len }, () => n++ & 0xff);
}

describe('base64url / utf8', () => {
  test('round trips every length and matches the RFC alphabet', () => {
    for (let len = 0; len < 40; len++) {
      const b = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) & 0xff);
      expect(fromB64url(toB64url(b))).toEqual(b);
      expect(toB64url(b)).toBe(Buffer.from(b).toString('base64url'));
    }
  });
  test('rejects padding, std alphabet and non-canonical tails', () => {
    expect(() => fromB64url('AA==')).toThrow();
    expect(() => fromB64url('a+b/')).toThrow();
    expect(() => fromB64url('AB')).toThrow(); // 'B' leaves non-zero spare bits
    expect(() => fromB64url('A')).toThrow();
    expect(isB64url('AA')).toBe(true);
    expect(isB64url('AAAA', 3)).toBe(true);
    expect(isB64url('AAAA', 4)).toBe(false);
  });
  test('utf8 matches TextEncoder and round trips', () => {
    for (const s of ['', 'abc', '王_明 付款码', '😀 emoji', '\u0000߿ࠀ￿']) {
      expect(utf8(s)).toEqual(new TextEncoder().encode(s));
      expect(fromUtf8(utf8(s))).toBe(s);
    }
    expect(() => fromUtf8(Uint8Array.from([0xc0, 0x80]))).toThrow();
    expect(() => fromUtf8(Uint8Array.from([0xe4, 0xb8]))).toThrow();
  });
});

describe('hkdf / sha256', () => {
  test('RFC 5869 test case 1', () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = Uint8Array.from({ length: 13 }, (_, i) => i);
    const info = Uint8Array.from({ length: 10 }, (_, i) => 0xf0 + i);
    expect(toHex(hkdfSha256(ikm, info, 42, salt))).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });
  test('share keys are deterministic and distinct', () => {
    const k = new Uint8Array(32).fill(7);
    const a = deriveShareKeys(k);
    const b = deriveShareKeys(Uint8Array.from(k));
    expect(a.authKey).toEqual(b.authKey);
    expect(a.encKey).toEqual(b.encKey);
    expect(a.authKey).not.toEqual(a.encKey);
    expect(deriveShareKeys(new Uint8Array(32).fill(8)).authKey).not.toEqual(a.authKey);
    // Pinned (cross-checked with node:crypto hkdfSync): a change here is a protocol break.
    expect(toHex(a.authKey)).toBe('acad15ec9e49328a5bf22955554bcb8716d11f37591ff37f0a0b1b0960a5daa9');
    expect(toHex(a.encKey)).toBe('251fa6e1dd604d6647ce46dcd4853735fefd9b227ce60be31ae7d6106d60cc05');
    expect(joinHash(a.authKey)).toBe(toB64url(sha256(a.authKey)));
    expect(() => deriveShareKeys(new Uint8Array(16))).toThrow();
  });
  test('sha256 known answer', () => {
    expect(toHex(sha256('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('envelopes', () => {
  const key = new Uint8Array(32).fill(1);
  test('seal/open round trip (JSON and bytes)', () => {
    const value = { code: '1234567890123456789', seq: 3, name: '王_明', nested: [1, null, true] };
    const env = seal(key, value);
    expect(env.v).toBe(1);
    expect(fromB64url(env.n).length).toBe(24);
    expect(open(key, env)).toEqual(value);
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    expect(openBytes(key, sealBytes(key, bytes))).toEqual(bytes);
  });
  test('fresh nonce each time', () => {
    expect(seal(key, 1).n).not.toBe(seal(key, 1).n);
  });
  test('injectable randomBytes is used', () => {
    const env = seal(key, 'x', { rand: counterRand(0) });
    expect(fromB64url(env.n)).toEqual(Uint8Array.from({ length: 24 }, (_, i) => i));
    expect(() => seal(key, 'x', { rand: () => new Uint8Array(3) })).toThrow();
  });
  test('rejects tampering, wrong key, wrong aad, bad versions', () => {
    const env = seal(key, { a: 1 }, { aad: 'meta' });
    const c = fromB64url(env.c);
    c[0]! ^= 1;
    expect(() => open(key, { ...env, c: toB64url(c) }, { aad: 'meta' })).toThrow(EnvelopeError);
    const n = fromB64url(env.n);
    n[5]! ^= 0x80;
    expect(() => open(key, { ...env, n: toB64url(n) }, { aad: 'meta' })).toThrow(EnvelopeError);
    expect(() => open(new Uint8Array(32).fill(2), env, { aad: 'meta' })).toThrow(EnvelopeError);
    expect(() => open(key, env)).toThrow(EnvelopeError);
    expect(() => open(key, env, { aad: 'other' })).toThrow(EnvelopeError);
    expect(() => open(key, { ...env, v: 2 } as never)).toThrow(EnvelopeError);
    expect(() => open(key, { ...env, n: 'AAAA' })).toThrow(EnvelopeError);
    expect(() => open(key, { ...env, c: env.c.slice(0, -4) }, { aad: 'meta' })).toThrow(EnvelopeError);
    expect(open(key, env, { aad: 'meta' })).toEqual({ a: 1 });
  });
  test('rejects short keys', () => {
    expect(() => seal(new Uint8Array(16), 1)).toThrow(EnvelopeError);
  });
});

describe('identity, signatures and peer keys', () => {
  test('device identity with injected RNG is deterministic', () => {
    const a = generateDeviceIdentity(counterRand());
    const b = generateDeviceIdentity(counterRand());
    expect(a.sign.publicKey).toEqual(b.sign.publicKey);
    expect(a.box.publicKey).toEqual(b.box.publicKey);
    expect(a.sign.secretKey).not.toEqual(a.box.secretKey);
  });
  test('sign/verify; tampered message or key fails without throwing', () => {
    const id = generateDeviceIdentity();
    const msg = utf8('hello');
    const sig = sign(msg, id.sign.secretKey);
    expect(verify(sig, msg, id.sign.publicKey)).toBe(true);
    expect(verify(sig, utf8('hellO'), id.sign.publicKey)).toBe(false);
    expect(verify(sig, msg, generateDeviceIdentity().sign.publicKey)).toBe(false);
    expect(verify(new Uint8Array(3), msg, id.sign.publicKey)).toBe(false);
  });
  test('owner and viewer derive the same per-peer key; frames round trip', () => {
    const k = generateShareSecret();
    const { encKey } = deriveShareKeys(k);
    const chan = generateBoxKeyPair();
    const peer = generateBoxKeyPair();
    const ownerKey = ownerPeerKey(chan.secretKey, chan.publicKey, peer.publicKey, encKey);
    const viewerKey = viewerPeerKey(peer.secretKey, peer.publicKey, chan.publicKey, encKey);
    expect(ownerKey).toEqual(viewerKey);
    const frame = { t: 'code', code: '987654', seq: 1 };
    expect(open(viewerKey, seal(ownerKey, frame))).toEqual(frame);
    // A second viewer (or the server, lacking encKey) gets a different key.
    const other = generateBoxKeyPair();
    expect(viewerPeerKey(other.secretKey, other.publicKey, chan.publicKey, encKey)).not.toEqual(ownerKey);
    expect(viewerPeerKey(peer.secretKey, peer.publicKey, chan.publicKey, new Uint8Array(32))).not.toEqual(ownerKey);
  });
  test('rejects a low-order peer key', () => {
    const chan = generateBoxKeyPair();
    expect(() => ownerPeerKey(chan.secretKey, chan.publicKey, new Uint8Array(32), new Uint8Array(32))).toThrow();
  });
});
