/**
 * Short-lived bearer tokens: `<kind>.<base64url(JSON claims)>.<base64url(HMAC-SHA256)>`, MAC
 * over `<kind>.<payload>`. Opaque to clients (the protocol only fixes `tokenClaims` for device
 * tokens). Two kinds:
 *
 * - `d1` device/plugin token (`POST /v1/auth/token`): `{ sub, plg, svc, iat, exp }`, 10 min.
 * - `p1` peer token (`POST /v1/c/:id/join`): `{ cid, pid, iat, exp }`. It is only valid while
 *   the claim exists, so a kick revokes it immediately; `exp` is a hard upper bound.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { type TokenClaims, channelIdSchema, peerIdSchema, tokenClaims, toB64url, fromB64url, fromUtf8, utf8 } from '@pku-harness/cloud-protocol';
import { z } from 'zod';

import type { Storage } from '../db/storage';

export const peerClaims = z.object({ cid: channelIdSchema, pid: peerIdSchema, iat: z.number().int(), exp: z.number().int() });
export type PeerClaims = z.infer<typeof peerClaims>;

type Kind = 'd1' | 'p1';

export class TokenSigner {
  constructor(private readonly secret: Uint8Array) {}

  private mac(data: string): Uint8Array {
    return createHmac('sha256', this.secret).update(data).digest();
  }

  private sign(kind: Kind, claims: object): string {
    const payload = toB64url(utf8(JSON.stringify(claims)));
    return `${kind}.${payload}.${toB64url(this.mac(`${kind}.${payload}`))}`;
  }

  private open(kind: Kind, token: string, now: number): unknown {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== kind) return undefined;
    let mac: Uint8Array;
    let claims: unknown;
    try {
      mac = fromB64url(parts[2]!);
      const expected = this.mac(`${kind}.${parts[1]}`);
      if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return undefined;
      claims = JSON.parse(fromUtf8(fromB64url(parts[1]!)));
    } catch {
      return undefined;
    }
    const exp = (claims as { exp?: unknown } | null)?.exp;
    if (typeof exp !== 'number' || exp <= now) return undefined;
    return claims;
  }

  signDevice(claims: TokenClaims): string {
    return this.sign('d1', claims);
  }
  verifyDevice(token: string, now: number): TokenClaims | undefined {
    const r = tokenClaims.safeParse(this.open('d1', token, now));
    return r.success ? r.data : undefined;
  }
  /**
   * A plugin's view of a device (docs/CLOUD-FUNCTIONS.md §6): stable per (device, plugin), so two
   * plugins can't correlate a user and the device id never reaches plugin scope.
   * `base64url(HMAC(secret, "pseudonym" NUL plugin NUL deviceId))[:22]` (NULs make it unambiguous).
   */
  pseudonym(plugin: string, deviceId: string): string {
    return toB64url(this.mac(`pseudonym\0${plugin}\0${deviceId}`)).slice(0, 22);
  }
  signPeer(claims: PeerClaims): string {
    return this.sign('p1', claims);
  }
  verifyPeer(token: string, now: number): PeerClaims | undefined {
    const r = peerClaims.safeParse(this.open('p1', token, now));
    return r.success ? r.data : undefined;
  }
}

/** Secret from config, else the one stored in the DB, else a fresh one (stored). */
export async function loadTokenSecret(storage: Storage, configured?: string): Promise<Uint8Array> {
  if (configured) return utf8(configured);
  const stored = await storage.getSetting('token_secret');
  if (stored) return fromB64url(stored);
  const fresh = new Uint8Array(randomBytes(32));
  await storage.setSetting('token_secret', toB64url(fresh));
  return fresh;
}

/** `Authorization: Bearer <t>`, else `?t=` (WebSocket/EventSource clients can't set headers). */
export function bearer(req: Request, allowQuery: boolean): string | undefined {
  const h = req.headers.get('authorization');
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  if (m) return m[1];
  if (!allowQuery) return undefined;
  const q = new URL(req.url).searchParams.get('t');
  return q || undefined;
}
