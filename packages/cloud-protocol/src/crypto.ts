/**
 * Envelope crypto for PKU Harness Cloud (docs/CLOUD.md §1.3, §2.2). Pure JavaScript on the
 * audited noble libraries, so the app (Hermes), the reference server (Bun) and viewer pages
 * (WeChat webview, no WebCrypto) share this one file and encryption cannot drift.
 *
 * - Identity: Ed25519 (signing) + X25519 (box) keypairs per device.
 * - Payloads: XChaCha20-Poly1305 with a random 24-byte nonce → `Envelope { v: 1, n, c }`.
 * - Share links: a 32-byte secret `k` in the URL fragment; `authKey`/`encKey` via HKDF-SHA256.
 * - Per-peer channel key: HKDF over X25519(chanPriv, peerPub) ‖ encKey.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils.js';

import { concatBytes, fromB64url, fromUtf8, toB64url, utf8 } from './bytes';

/**
 * Source of cryptographically secure random bytes. Defaults to `crypto.getRandomValues`
 * (Bun, browsers; React Native once `expo-crypto` is polyfilled). Pass one explicitly to be
 * independent of globals, e.g. `(n) => Crypto.getRandomBytes(n)` from expo-crypto.
 */
export type RandomBytes = (length: number) => Uint8Array;

export const defaultRandomBytes: RandomBytes = (n) => nobleRandomBytes(n);

const rng = (rand?: RandomBytes): RandomBytes => rand ?? defaultRandomBytes;

function take(rand: RandomBytes | undefined, n: number): Uint8Array {
  const b = rng(rand)(n);
  if (!(b instanceof Uint8Array) || b.length !== n) throw new Error(`randomBytes(${n}) returned ${b?.length ?? 'nothing'}`);
  return b;
}

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const SIG_BYTES = 64;

/** HKDF `info` labels; the protocol version is part of every label (domain separation). */
export const KDF_INFO = {
  join: 'pku-harness-cloud/v1/join',
  enc: 'pku-harness-cloud/v1/enc',
  peer: 'pku-harness-cloud/v1/peer',
} as const;

// --- hashing / kdf ----------------------------------------------------------------------

export function sha256(data: Uint8Array | string): Uint8Array {
  return nobleSha256(typeof data === 'string' ? utf8(data) : data);
}

/** HKDF-SHA256 (RFC 5869). `info`/`salt` strings are UTF-8 encoded. */
export function hkdfSha256(ikm: Uint8Array, info: string | Uint8Array, length = KEY_BYTES, salt?: Uint8Array): Uint8Array {
  return hkdf(nobleSha256, ikm, salt, typeof info === 'string' ? utf8(info) : info, length);
}

// --- keypairs ---------------------------------------------------------------------------

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

/** Ed25519 signing keypair (32-byte seed, 32-byte public key). */
export function generateSignKeyPair(rand?: RandomBytes): KeyPair {
  const secretKey = take(rand, KEY_BYTES);
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

/** X25519 box keypair: device box key, channel key, or a viewer's ephemeral key. */
export function generateBoxKeyPair(rand?: RandomBytes): KeyPair {
  const secretKey = take(rand, KEY_BYTES);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export interface DeviceIdentity {
  sign: KeyPair;
  box: KeyPair;
}

/** A device's cloud identity (docs/CLOUD.md §2.1: no campus identity, only keys). */
export function generateDeviceIdentity(rand?: RandomBytes): DeviceIdentity {
  return { sign: generateSignKeyPair(rand), box: generateBoxKeyPair(rand) };
}

export function signPublicKey(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}

export function boxPublicKey(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey);
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, secretKey);
}

/** Never throws: malformed keys or signatures verify as false. */
export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

// --- envelopes --------------------------------------------------------------------------

/** Sealed payload on the wire and at rest: `n` = 24-byte nonce, `c` = ciphertext ‖ tag, both base64url. */
export interface Envelope {
  v: 1;
  n: string;
  c: string;
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

function aadBytes(aad?: string | Uint8Array): Uint8Array | undefined {
  if (aad === undefined) return undefined;
  return typeof aad === 'string' ? utf8(aad) : aad;
}

/**
 * Encrypt bytes under a 32-byte key. `aad` (associated data, e.g. a channel id or a frame
 * kind) is authenticated but not sent: the opener must pass the same value.
 */
export function sealBytes(key: Uint8Array, plaintext: Uint8Array, opts?: { aad?: string | Uint8Array; rand?: RandomBytes }): Envelope {
  if (key.length !== KEY_BYTES) throw new EnvelopeError('key must be 32 bytes');
  const nonce = take(opts?.rand, NONCE_BYTES);
  const c = xchacha20poly1305(key, nonce, aadBytes(opts?.aad)).encrypt(plaintext);
  return { v: 1, n: toB64url(nonce), c: toB64url(c) };
}

/** Decrypt; throws `EnvelopeError` on a wrong key, wrong aad, tampering or a malformed envelope. */
export function openBytes(key: Uint8Array, env: Envelope, opts?: { aad?: string | Uint8Array }): Uint8Array {
  if (key.length !== KEY_BYTES) throw new EnvelopeError('key must be 32 bytes');
  if (!env || env.v !== 1) throw new EnvelopeError('unsupported envelope version');
  let nonce: Uint8Array;
  let c: Uint8Array;
  try {
    nonce = fromB64url(env.n);
    c = fromB64url(env.c);
  } catch {
    throw new EnvelopeError('malformed envelope');
  }
  if (nonce.length !== NONCE_BYTES) throw new EnvelopeError('bad nonce length');
  try {
    return xchacha20poly1305(key, nonce, aadBytes(opts?.aad)).decrypt(c);
  } catch {
    throw new EnvelopeError('decryption failed');
  }
}

/** Seal a JSON value. */
export function seal(key: Uint8Array, value: unknown, opts?: { aad?: string | Uint8Array; rand?: RandomBytes }): Envelope {
  const json = JSON.stringify(value);
  if (json === undefined) throw new EnvelopeError('value is not JSON-serialisable');
  return sealBytes(key, utf8(json), opts);
}

/** Open a JSON value sealed with `seal`. Validate the result (zod) before trusting its shape. */
export function open<T = unknown>(key: Uint8Array, env: Envelope, opts?: { aad?: string | Uint8Array }): T {
  const bytes = openBytes(key, env, opts);
  try {
    return JSON.parse(fromUtf8(bytes)) as T;
  } catch {
    throw new EnvelopeError('payload is not JSON');
  }
}

// --- share links ------------------------------------------------------------------------

export interface ShareKeys {
  /** Sent to the server on join; the server stores only `joinHash = sha256(authKey)`. */
  authKey: Uint8Array;
  /** Never leaves the devices: seals channel meta and feeds the per-peer key. */
  encKey: Uint8Array;
}

/** Fresh 32-byte link secret `k` (goes only into the `#k=` fragment). */
export function generateShareSecret(rand?: RandomBytes): Uint8Array {
  return take(rand, KEY_BYTES);
}

export function deriveShareKeys(k: Uint8Array): ShareKeys {
  if (k.length !== KEY_BYTES) throw new Error('share secret must be 32 bytes');
  return { authKey: hkdfSha256(k, KDF_INFO.join), encKey: hkdfSha256(k, KDF_INFO.enc) };
}

/** What the server stores to gate joins: base64url(sha256(authKey)). */
export function joinHash(authKey: Uint8Array): string {
  return toB64url(sha256(authKey));
}

/**
 * Key for frames between the channel owner and one peer (both directions). The owner calls
 * `ownerPeerKey`, the viewer `viewerPeerKey`; both get the same key. Formula: HKDF-SHA256(ikm = X25519(own, other) ‖ encKey,
 * salt = chanPub ‖ peerPub, info = KDF_INFO.peer). The salt binds the key to both public keys.
 */
export function derivePeerKey(opts: { secretKey: Uint8Array; otherPublicKey: Uint8Array; chanPub: Uint8Array; peerPub: Uint8Array; encKey: Uint8Array }): Uint8Array {
  const shared = x25519.getSharedSecret(opts.secretKey, opts.otherPublicKey);
  let zero = 0;
  for (const b of shared) zero |= b;
  if (zero === 0) throw new Error('x25519: low-order public key');
  return hkdfSha256(concatBytes(shared, opts.encKey), KDF_INFO.peer, KEY_BYTES, concatBytes(opts.chanPub, opts.peerPub));
}

/** Owner side of `derivePeerKey`. */
export function ownerPeerKey(chanPriv: Uint8Array, chanPub: Uint8Array, peerPub: Uint8Array, encKey: Uint8Array): Uint8Array {
  return derivePeerKey({ secretKey: chanPriv, otherPublicKey: peerPub, chanPub, peerPub, encKey });
}

/** Viewer side of `derivePeerKey`. */
export function viewerPeerKey(peerPriv: Uint8Array, peerPub: Uint8Array, chanPub: Uint8Array, encKey: Uint8Array): Uint8Array {
  return derivePeerKey({ secretKey: peerPriv, otherPublicKey: chanPub, chanPub, peerPub, encKey });
}
