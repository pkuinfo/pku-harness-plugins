/** Batch-mode mailbox: the owner leaves sealed blobs that claimed peers can read while it's offline. */
import { mailboxListResponse, mailboxPutRequest, mailboxPutResponse, mailboxSlotSchema, okResponse } from '@pku-harness/cloud-protocol';
import type { Hono } from 'hono';

import { envelopeTooLarge } from '../channels/hub';
import type { AppEnv, Deps } from '../context';
import { HttpError, parseWith, readJson } from '../errors';
import { isLive, ownedChannel } from './channels';
import { peerAuth } from './peer';

export function mailboxRoutes(app: Hono<AppEnv>, deps: Deps) {
  const lim = deps.config.limits.channels;

  app.put('/v1/channels/:id/mailbox/:slot', async (c) => {
    const ch = await ownedChannel(c, deps);
    const slot = parseWith(mailboxSlotSchema, c.req.param('slot'));
    const body = await readJson(c, mailboxPutRequest);
    const now = deps.now();
    if (!isLive(ch, now)) throw new HttpError('gone', 'channel closed or expired');
    if (envelopeTooLarge(body.env, lim.frameBytes)) throw new HttpError('payload_too_large', 'envelope too large');
    // A slot never outlives its channel.
    const expiresAt = Math.min(now + body.ttlS * 1000, ch.expiresAt);
    if (!(await deps.storage.mailboxPut(ch.id, { slot, env: body.env, expiresAt }, lim.mailboxSlots, now)))
      throw new HttpError('quota', `at most ${lim.mailboxSlots} mailbox slots per channel`);
    return c.json(mailboxPutResponse.parse({ ok: true }));
  });

  app.delete('/v1/channels/:id/mailbox/:slot', async (c) => {
    const ch = await ownedChannel(c, deps);
    await deps.storage.mailboxDelete(ch.id, parseWith(mailboxSlotSchema, c.req.param('slot')));
    return c.json(okResponse.parse({ ok: true }));
  });

  /** Clear every slot (`channel.mailbox.clear()`). */
  app.delete('/v1/channels/:id/mailbox', async (c) => {
    const ch = await ownedChannel(c, deps);
    await deps.storage.mailboxClear(ch.id);
    return c.json(okResponse.parse({ ok: true }));
  });

  app.get('/v1/c/:id/mailbox', async (c) => {
    const { ch } = await peerAuth(c, deps);
    const items = await deps.storage.mailboxList(ch.id, deps.now());
    c.header('Cache-Control', 'no-store');
    return c.json(mailboxListResponse.parse({ items }));
  });
}
