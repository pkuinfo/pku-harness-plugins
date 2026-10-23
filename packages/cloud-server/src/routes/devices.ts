/** `POST /v1/devices` (proof of work) and `DELETE /v1/devices/me` (wipe everything). */
import { randomBytes } from 'node:crypto';

import { deleteDeviceResponse, registerDeviceRequest, registerDeviceResponse, toB64url } from '@pku-harness/cloud-protocol';
import type { Hono } from 'hono';

import type { AppEnv, Deps } from '../context';
import { HttpError, readJson } from '../errors';
import { limit } from '../limits';
import { requireToken } from './auth';

export function deviceRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.post('/v1/devices', async (c) => {
    limit(c, deps.limiter, `register:${c.get('ip')}`, deps.config.rates.register);
    const body = await readJson(c, registerDeviceRequest);
    const now = deps.now();
    if (!(await deps.pow.check({ salt: body.pow.salt, nonce: body.pow.nonce, signPub: body.signPub, boxPub: body.boxPub }, now)))
      throw new HttpError('pow_invalid', 'proof of work invalid or salt expired; refetch /v1/meta');
    const device = await deps.storage.createDevice({ id: toB64url(new Uint8Array(randomBytes(16))), signPub: body.signPub, boxPub: body.boxPub, createdAt: now });
    return c.json(registerDeviceResponse.parse({ deviceId: device.id }));
  });

  app.delete('/v1/devices/me', async (c) => {
    const auth = await requireToken(c, deps);
    const { openChannels } = await deps.storage.deleteDevice(auth.sub);
    for (const id of openChannels) deps.hub.disconnectAll(id, 'revoked');
    deps.log.log('info', 'device_deleted', { channels: openChannels.length });
    return c.json(deleteDeviceResponse.parse({ ok: true }));
  });
}
