/** `GET /v1/meta`: what this provider offers (clients check it at connect). */
import { PROTOCOL_VERSION, type MetaResponse } from '@pku-harness/cloud-protocol';
import type { Hono } from 'hono';

import type { AppEnv, Deps } from '../context';
import { OFFERED } from './auth';

export function metaRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.get('/v1/meta', async (c) => {
    // push/functions limits are advertised only once those services exist (stage 6).
    const { push: _push, functions: _functions, ...limits } = deps.config.limits;
    const body: MetaResponse = {
      protocol: PROTOCOL_VERSION,
      services: OFFERED,
      limits,
      pow: await deps.pow.advertise(deps.now()),
      pages: deps.pages.list(),
      functions: [],
      operator: deps.config.operator,
    };
    c.header('Cache-Control', 'no-cache');
    return c.json(body);
  });
}
