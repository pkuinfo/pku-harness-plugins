/**
 * Signed token challenge for `POST /v1/auth/token` (docs/CLOUD.md §2.3).
 *
 * The device signs, with its Ed25519 identity key, the UTF-8 bytes of these lines joined by
 * "\n" (no trailing newline):
 *
 *   pku-harness-cloud/v1/auth
 *   <aud>        provider origin, lowercase `scheme://host[:port]` (no path, no trailing slash)
 *   <deviceId>
 *   <plugin>
 *   <services>   requested services, deduplicated, sorted, joined by ","
 *   <ts>         Unix time in milliseconds, decimal integer
 *   <nonce>      16 random bytes, base64url
 *   [doc <hash> <link>]   only when the request carries `doc` (server functions,
 *                docs/CLOUD-FUNCTIONS.md §7): the consented document's sha256 hex and link
 *
 * Every field is validated against a newline-free charset, so the encoding is unambiguous.
 * `aud` stops a provider from replaying a device's signature at another provider; the server
 * compares it with its own configured origin. The server accepts `|now - ts| ≤ AUTH_MAX_SKEW_MS`
 * and remembers nonces for that window (reject reuse).
 *
 * The optional `doc` line keeps older challenges valid: without `doc` the bytes are exactly the
 * seven lines above, and a signature over seven lines can't be replayed with a `doc` added (the
 * signed bytes differ).
 */
import { fromB64url, toB64url, utf8 } from './bytes';
import { type RandomBytes, SIG_BYTES, defaultRandomBytes, sign, verify } from './crypto';
import { type CloudServiceName, type DocClaim, cloudService, deviceIdSchema, docClaimSchema, pluginIdSchema } from './schemas';

export const AUTH_CONTEXT = 'pku-harness-cloud/v1/auth';
export const AUTH_MAX_SKEW_MS = 5 * 60_000;
export const AUTH_NONCE_BYTES = 16;
/** Bearer token lifetime the server issues (10 min). */
export const TOKEN_TTL_S = 600;

export interface AuthChallenge {
  aud: string;
  deviceId: string;
  plugin: string;
  services: CloudServiceName[];
  ts: number;
  nonce: string;
  /** The plugin document version this token may run server functions of. */
  doc?: DocClaim;
}

/** `https://Example.org:443/x/` → `https://example.org:443`. Throws for non-http(s). */
export function normaliseAudience(baseURL: string): string {
  const m = /^(https?):\/\/([^/?#\s@]+)/i.exec(baseURL.trim());
  if (!m) throw new Error('audience must be an http(s) origin');
  return `${m[1]!.toLowerCase()}://${m[2]!.toLowerCase()}`;
}

/** The exact bytes that get signed (see module doc). Throws on any field that breaks the format. */
export function authChallengeBytes(c: AuthChallenge): Uint8Array {
  if (normaliseAudience(c.aud) !== c.aud) throw new Error('aud must be a normalised origin');
  if (!deviceIdSchema.safeParse(c.deviceId).success) throw new Error('bad deviceId');
  if (!pluginIdSchema.safeParse(c.plugin).success) throw new Error('bad plugin id');
  if (!Number.isSafeInteger(c.ts) || c.ts < 0) throw new Error('ts must be integer milliseconds');
  let nonce: Uint8Array;
  try {
    nonce = fromB64url(c.nonce);
  } catch {
    throw new Error('bad nonce');
  }
  if (nonce.length !== AUTH_NONCE_BYTES) throw new Error('bad nonce length');
  const services = [...new Set(c.services.map((s) => cloudService.parse(s)))].sort();
  const lines = [AUTH_CONTEXT, c.aud, c.deviceId, c.plugin, services.join(','), String(c.ts), c.nonce];
  if (c.doc !== undefined) {
    if (!docClaimSchema.safeParse(c.doc).success) throw new Error('bad doc claim');
    lines.push(`doc ${c.doc.hash} ${c.doc.link}`);
  }
  return utf8(lines.join('\n'));
}

/** Build a fresh challenge and sign it; the result is the `POST /v1/auth/token` body. */
export function signAuthChallenge(
  input: { aud: string; deviceId: string; plugin: string; services: CloudServiceName[]; doc?: DocClaim; now?: number; rand?: RandomBytes },
  signSecretKey: Uint8Array,
): AuthChallenge & { sig: string } {
  const c: AuthChallenge = {
    aud: normaliseAudience(input.aud),
    deviceId: input.deviceId,
    plugin: input.plugin,
    services: [...new Set(input.services)].sort(),
    ts: Math.floor(input.now ?? Date.now()),
    nonce: toB64url((input.rand ?? defaultRandomBytes)(AUTH_NONCE_BYTES)),
    ...(input.doc ? { doc: { link: input.doc.link, hash: input.doc.hash } } : {}),
  };
  return { ...c, sig: toB64url(sign(authChallengeBytes(c), signSecretKey)) };
}

export type AuthVerifyResult = { ok: true } | { ok: false; reason: 'audience' | 'skew' | 'format' | 'signature' };

/**
 * Server side: check audience, clock skew, format and signature. Nonce replay tracking is the
 * server's job (it needs state).
 */
export function verifyAuthChallenge(
  body: AuthChallenge & { sig: string },
  signPublicKey: Uint8Array,
  opts: { aud: string; now?: number; maxSkewMs?: number },
): AuthVerifyResult {
  let expected: string;
  try {
    expected = normaliseAudience(opts.aud);
  } catch {
    return { ok: false, reason: 'audience' };
  }
  if (body.aud !== expected) return { ok: false, reason: 'audience' };
  const now = opts.now ?? Date.now();
  if (!Number.isFinite(body.ts) || Math.abs(now - body.ts) > (opts.maxSkewMs ?? AUTH_MAX_SKEW_MS)) return { ok: false, reason: 'skew' };
  let msg: Uint8Array;
  let sig: Uint8Array;
  try {
    msg = authChallengeBytes(body);
    sig = fromB64url(body.sig);
  } catch {
    return { ok: false, reason: 'format' };
  }
  if (sig.length !== SIG_BYTES) return { ok: false, reason: 'format' };
  return verify(sig, msg, signPublicKey) ? { ok: true } : { ok: false, reason: 'signature' };
}
