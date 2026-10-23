/** `POST /v1/auth/token` and the bearer-token guard used by device/plugin routes. */
import { type CloudServiceName, TOKEN_TTL_S, authTokenRequest, authTokenResponse } from '@pku-harness/cloud-protocol';
import type { Context, Hono } from 'hono';

import { checkSignedChallenge } from '../auth/sig';
import { bearer } from '../auth/token';
import type { AppEnv, Deps } from '../context';
import { HttpError, readJson } from '../errors';
import { limit } from '../limits';

/** Services this server implements (meta + token minting). */
export const OFFERED: CloudServiceName[] = ['store', 'channels', 'functions'];

/**
 * Verify the device token and that the device still exists (a wipe revokes live tokens), and
 * optionally that it was minted for `service`. Sets `c.var.auth`.
 */
export async function requireToken(c: Context<AppEnv>, deps: Deps, service?: CloudServiceName, allowQuery = false) {
  const raw = bearer(c.req.raw, allowQuery);
  if (!raw) throw new HttpError('unauthorized', 'missing bearer token');
  const claims = deps.tokens.verifyDevice(raw, deps.now());
  if (!claims) throw new HttpError('unauthorized', 'invalid or expired token');
  if (!(await deps.storage.getDevice(claims.sub))) throw new HttpError('unauthorized', 'unknown device');
  if (service && !claims.svc.includes(service)) throw new HttpError('forbidden', `token lacks the ${service} service`);
  c.set('auth', claims);
  return claims;
}

export function authRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.post('/v1/auth/token', async (c) => {
    const body = await readJson(c, authTokenRequest);
    limit(c, deps.limiter, `token:${body.deviceId}`, deps.config.rates.token);
    const device = await deps.storage.getDevice(body.deviceId);
    if (!device) throw new HttpError('unauthorized', 'unknown device');
    const now = deps.now();
    const r = await checkSignedChallenge(deps.storage, device, body, { aud: deps.aud, now });
    if (!r.ok) {
      const msg = { audience: 'wrong audience', skew: 'timestamp outside the allowed skew', format: 'malformed challenge', signature: 'bad signature', replay: 'nonce already used' }[r.reason];
      throw new HttpError('unauthorized', msg);
    }
    const svc = OFFERED.filter((s) => body.services.includes(s));
    if (svc.length === 0) throw new HttpError('unsupported', 'none of the requested services is offered');
    const exp = now + TOKEN_TTL_S * 1000;
    // The doc claim was part of the signed challenge: the device consented to exactly this version.
    const doc = svc.includes('functions') && body.doc ? { doc: body.doc } : {};
    const token = deps.tokens.signDevice({ sub: device.id, plg: body.plugin, svc, iat: now, exp, ...doc });
    return c.json(authTokenResponse.parse({ token, expiresAt: exp }));
  });
}
