/** `GET /v1/meta`: what this provider offers (clients check it at connect). */
import { PROTOCOL_VERSION, type MetaResponse } from '@pku-harness/cloud-protocol';
import type { Hono } from 'hono';

import type { AppEnv, Deps } from '../context';
import { OFFERED } from './auth';

export function metaRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.get('/v1/meta', async (c) => {
    // push limits are advertised only once that service exists (stage 5).
    const { push: _push, ...limits } = deps.config.limits;
    const body: MetaResponse = {
      protocol: PROTOCOL_VERSION,
      services: OFFERED,
      limits,
      pow: await deps.pow.advertise(deps.now()),
      pages: deps.pages.list(),
      functions: [],
      serverFunctions: { policy: deps.fn.policy.policy },
      operator: deps.config.operator,
    };
    c.header('Cache-Control', 'no-cache');
    return c.json(body);
  });
}
