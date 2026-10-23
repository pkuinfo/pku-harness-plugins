/**
 * Signed-challenge verification for `POST /v1/auth/token`: audience, ±5 min skew, Ed25519
 * signature (all in cloud-protocol's `verifyAuthChallenge`), plus nonce replay tracking, which
 * needs server state. Nonces are remembered for twice the skew window, so a replay can never
 * fall outside both the window and the memory.
 */
import { AUTH_MAX_SKEW_MS, type AuthChallenge, fromB64url, verifyAuthChallenge } from '@pku-harness/cloud-protocol';

import type { DeviceRow, Storage } from '../db/storage';

export type SigCheck = { ok: true } | { ok: false; reason: 'audience' | 'skew' | 'format' | 'signature' | 'replay' };

export async function checkSignedChallenge(
  storage: Storage,
  device: DeviceRow,
  body: AuthChallenge & { sig: string },
  opts: { aud: string; now: number },
): Promise<SigCheck> {
  const r = verifyAuthChallenge(body, fromB64url(device.signPub), { aud: opts.aud, now: opts.now });
  if (!r.ok) return r;
  const fresh = await storage.useNonce(device.id, body.nonce, opts.now + 2 * AUTH_MAX_SKEW_MS);
  return fresh ? { ok: true } : { ok: false, reason: 'replay' };
}
