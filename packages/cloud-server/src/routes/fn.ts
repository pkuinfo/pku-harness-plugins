/** `POST /v1/fn/:plugin/:name`: server functions arrive in stage 6 (docs/CLOUD.md §4). */
import type { Hono } from 'hono';

import type { AppEnv } from '../context';
import { HttpError } from '../errors';

export function fnRoutes(app: Hono<AppEnv>) {
  app.all('/v1/fn/*', () => {
    throw new HttpError('unsupported', 'functions are not offered by this server');
  });
}
