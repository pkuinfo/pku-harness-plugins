import { describe, expect, test } from 'bun:test';

import { fromUtf8, toB64url } from './bytes';
import { AUTH_MAX_SKEW_MS, authChallengeBytes, normaliseAudience, signAuthChallenge, verifyAuthChallenge } from './auth';
import { generateSignKeyPair } from './crypto';
import { authTokenRequest } from './schemas';

const key = generateSignKeyPair();
const now = 1_790_000_000_000;
const base = { aud: 'https://S.Example.org/relay/', deviceId: 'dev_ABCDEFGH', plugin: 'card-share', services: ['store', 'channels'] as ('store' | 'channels')[], now };

describe('auth challenge', () => {
  test('canonical bytes', () => {
    const body = signAuthChallenge({ ...base, rand: (n) => new Uint8Array(n) }, key.secretKey);
    expect(body.aud).toBe('https://s.example.org');
    expect(body.services).toEqual(['channels', 'store']);
    expect(fromUtf8(authChallengeBytes(body))).toBe(
      ['pku-harness-cloud/v1/auth', 'https://s.example.org', 'dev_ABCDEFGH', 'card-share', 'channels,store', String(now), toB64url(new Uint8Array(16))].join('\n'),
    );
    expect(authTokenRequest.safeParse(body).success).toBe(true);
  });
  test('verify ok, then every failure mode', () => {
    const body = signAuthChallenge(base, key.secretKey);
    const opts = { aud: 'https://s.example.org', now };
    expect(verifyAuthChallenge(body, key.publicKey, opts)).toEqual({ ok: true });
    // service order in the body doesn't matter (the bytes sort them)
    expect(verifyAuthChallenge({ ...body, services: ['store', 'channels'] }, key.publicKey, opts).ok).toBe(true);
    expect(verifyAuthChallenge(body, key.publicKey, { ...opts, aud: 'https://evil.example' })).toEqual({ ok: false, reason: 'audience' });
    expect(verifyAuthChallenge(body, key.publicKey, { ...opts, now: now + AUTH_MAX_SKEW_MS + 1 })).toEqual({ ok: false, reason: 'skew' });
    expect(verifyAuthChallenge({ ...body, plugin: 'wallet' }, key.publicKey, opts)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyAuthChallenge({ ...body, services: ['store'] }, key.publicKey, opts)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyAuthChallenge(body, generateSignKeyPair().publicKey, opts)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyAuthChallenge({ ...body, plugin: 'a\nb' }, key.publicKey, opts)).toEqual({ ok: false, reason: 'format' });
    expect(verifyAuthChallenge({ ...body, sig: 'AAAA' }, key.publicKey, opts)).toEqual({ ok: false, reason: 'format' });
  });
  test('audience normalisation', () => {
    expect(normaliseAudience('HTTP://10.0.2.2:8787/x')).toBe('http://10.0.2.2:8787');
    expect(() => normaliseAudience('pkuharness://x')).toThrow();
  });
});
