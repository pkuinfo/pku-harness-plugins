/** `/v1/push/*`: push arrives in stage 6 (docs/CLOUD.md §4). */
import type { Hono } from 'hono';

import type { AppEnv } from '../context';
import { HttpError } from '../errors';

export function pushRoutes(app: Hono<AppEnv>) {
  app.all('/v1/push/*', () => {
    throw new HttpError('unsupported', 'push is not offered by this server');
  });
}
