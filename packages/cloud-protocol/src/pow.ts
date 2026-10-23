/**
 * Proof of work for `POST /v1/devices` (anti-farming, docs/CLOUD.md §2.3, §5.8).
 *
 *   prefix = UTF-8("pku-harness-cloud/v1/pow\n" + salt + "\n" + signPub + "\n" + boxPub + "\n")
 *   hash   = SHA-256(prefix ‖ UTF-8(nonce))
 *
 * `nonce` is a decimal integer string (no sign, no leading zeros, ≤ 15 digits). The work is
 * valid when `hash` starts with at least `difficulty` zero bits (big-endian, most significant
 * bit of byte 0 first). `salt` and `difficulty` come from `GET /v1/meta` (`pow`); the server
 * accepts its current salt and the previous one, so a rotation never fails a solve in flight.
 * Binding the keys into the prefix means one solution registers exactly one identity.
 *
 * Expected work is 2^difficulty hashes. Noble SHA-256 on Hermes does very roughly 50k short
 * hashes/s on a mid-range phone, so difficulty 16 ≈ 1 s (tune per deployment).
 */
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

import { utf8 } from './bytes';

export const POW_CONTEXT = 'pku-harness-cloud/v1/pow';
export const DEFAULT_POW_DIFFICULTY = 16;
/** Clients refuse more than this, so a hostile provider can't make phones spin forever. */
export const MAX_POW_DIFFICULTY = 28;
const NONCE_RE = /^(0|[1-9][0-9]{0,14})$/;

export interface PowChallenge {
  salt: string;
  signPub: string;
  boxPub: string;
}

export function powPrefix(c: PowChallenge): Uint8Array {
  for (const v of [c.salt, c.signPub, c.boxPub]) if (/[\n\r]/.test(v)) throw new Error('pow fields must not contain newlines');
  return utf8(`${POW_CONTEXT}\n${c.salt}\n${c.signPub}\n${c.boxPub}\n`);
}

/** Number of leading zero bits of `hash`. */
export function leadingZeroBits(hash: Uint8Array): number {
  let n = 0;
  for (const b of hash) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

export function powHash(c: PowChallenge, nonce: string): Uint8Array {
  return nobleSha256.create().update(powPrefix(c)).update(utf8(nonce)).digest();
}

/** Server side (and tests): is `nonce` a valid solution at `difficulty`? */
export function verifyPow(c: PowChallenge, nonce: string, difficulty: number): boolean {
  if (!NONCE_RE.test(nonce)) return false;
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 256) return false;
  try {
    return leadingZeroBits(powHash(c, nonce)) >= difficulty;
  } catch {
    return false;
  }
}

/**
 * Find a nonce. Runs in chunks and yields to the event loop between them so a phone's UI keeps
 * rendering; abort with `signal`. Rejects above `MAX_POW_DIFFICULTY` or after `maxAttempts`.
 */
export async function solvePow(
  c: PowChallenge,
  difficulty: number,
  opts?: { signal?: AbortSignal; chunk?: number; maxAttempts?: number; onProgress?: (attempts: number) => void },
): Promise<{ nonce: string; attempts: number }> {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > MAX_POW_DIFFICULTY) throw new Error(`pow difficulty ${difficulty} out of range 0–${MAX_POW_DIFFICULTY}`);
  const base = nobleSha256.create().update(powPrefix(c));
  const chunk = opts?.chunk ?? 2048;
  const max = opts?.maxAttempts ?? 2 ** (difficulty + 6);
  for (let i = 0; i < max; ) {
    if (opts?.signal?.aborted) throw new Error('pow aborted');
    const end = Math.min(i + chunk, max);
    for (; i < end; i++) {
      const nonce = String(i);
      if (leadingZeroBits(base.clone().update(utf8(nonce)).digest()) >= difficulty) return { nonce, attempts: i + 1 };
    }
    opts?.onProgress?.(i);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  throw new Error('pow: no solution within maxAttempts');
}
