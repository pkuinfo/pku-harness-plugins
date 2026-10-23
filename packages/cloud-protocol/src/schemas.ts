/**
 * Wire schemas for PKU Harness Cloud protocol v1 (docs/CLOUD.md §2.3). Every provider
 * (official, self-hosted, BYO) serves exactly these shapes; the app, the reference server and
 * viewer pages validate with the same objects. Unknown object keys are stripped on parse, so a
 * newer server may add fields without breaking older clients.
 *
 * Binary values are base64url without padding. Times are Unix milliseconds unless the name
 * ends in `S` (seconds, used for durations).
 */
import { z } from 'zod';

import { isB64url } from './bytes';

export const PROTOCOL_VERSION = 1;

// --- primitives -------------------------------------------------------------------------

export const b64url = z.string().regex(/^[A-Za-z0-9_-]*$/, 'base64url').refine((s) => isB64url(s), 'non-canonical base64url');
export const b64urlBytes = (n: number) => z.string().refine((s) => isB64url(s, n), `base64url of ${n} bytes`);
/** 32-byte public key (Ed25519 or X25519) / secret. */
export const key32 = b64urlBytes(32);
export const sig64 = b64urlBytes(64);

export const cloudService = z.enum(['store', 'channels', 'push', 'files', 'functions']);
export type CloudServiceName = z.infer<typeof cloudService>;

/** Same rule as registry ids (`registry/schema.ts`), plus `mcp-…` host ids for remote plugins. */
export const pluginIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);
/** Server-generated, base64url. */
export const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export const channelIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export const peerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/);
/** Store keys: path-like, no `..` segments. */
export const storeKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9._:/-]{1,256}$/)
  .refine((k) => !k.split('/').some((s) => s === '..' || s === '.'), 'no dot segments');
export const mailboxSlotSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);
export const pageNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/);
export const functionNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);

export const envelopeSchema = z.object({ v: z.literal(1), n: b64urlBytes(24), c: b64url.refine((s) => s.length >= 22, 'ciphertext shorter than the tag') });

const ms = z.number().int().nonnegative();
const ok = z.object({ ok: z.literal(true) });
export const okResponse = ok;

// --- errors -----------------------------------------------------------------------------

/** Error codes in error bodies. Clients map them onto the SDK's `CloudErrorCode`. */
export const wireErrorCode = z.enum([
  'bad_request',
  'unauthorized', // missing/expired token or bad signature
  'forbidden', // token lacks the service, not the owner, wrong authKey
  'not_found',
  'gone', // channel closed or expired, key expired
  'conflict', // If-Match version mismatch, channel already claimed (maxPeers)
  'payload_too_large',
  'rate_limited',
  'quota',
  'pow_invalid',
  'unsupported', // service not offered by this provider
  'server',
]);
export type WireErrorCode = z.infer<typeof wireErrorCode>;

/** Body of every non-2xx response. 429 also carries `Retry-After` and `RateLimit-*` headers. */
export const errorBody = z.object({
  error: z.object({
    code: wireErrorCode,
    message: z.string(),
    retryAfterS: z.number().nonnegative().optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBody>;

// --- GET /v1/meta -----------------------------------------------------------------------

export const limitsSchema = z.object({
  store: z.object({ maxBytes: z.number().int(), maxKeys: z.number().int(), maxValueBytes: z.number().int() }),
  channels: z.object({
    maxOpen: z.number().int(),
    minTtlS: z.number().int(),
    maxTtlS: z.number().int(),
    defaultTtlS: z.number().int(),
    maxPeers: z.number().int(),
    frameBytes: z.number().int(),
    framesPerMin: z.number().int(),
    mailboxSlots: z.number().int(),
  }),
  push: z.object({ maxPending: z.number().int() }).optional(),
  functions: z.object({ callsPerMin: z.number().int() }).optional(),
  joinsPerIpPerMin: z.number().int(),
});
export type Limits = z.infer<typeof limitsSchema>;

/** Defaults from docs/CLOUD.md §1.3 and §2.3. */
export const DEFAULT_LIMITS: Limits = {
  store: { maxBytes: 1_000_000, maxKeys: 1000, maxValueBytes: 64_000 },
  channels: { maxOpen: 5, minTtlS: 60, maxTtlS: 86_400, defaultTtlS: 900, maxPeers: 5, frameBytes: 4096, framesPerMin: 60, mailboxSlots: 64 },
  push: { maxPending: 100 },
  functions: { callsPerMin: 60 },
  joinsPerIpPerMin: 20,
};

export const metaResponse = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  services: z.array(cloudService),
  limits: limitsSchema,
  /** Proof of work for device registration (see pow.ts). */
  pow: z.object({ difficulty: z.number().int().min(0).max(64), salt: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }),
  /** Static viewer pages served at /w/<plugin>/<page>. */
  pages: z.array(z.object({ plugin: pluginIdSchema, page: pageNameSchema })),
  functions: z.array(z.object({ plugin: pluginIdSchema, name: functionNameSchema, version: z.number().int().positive() })),
  operator: z.object({ name: z.string().min(1), contact: z.string(), privacyURL: z.string().url().optional() }),
});
export type MetaResponse = z.infer<typeof metaResponse>;

// --- devices & auth ---------------------------------------------------------------------

/** POST /v1/devices (auth: proof of work). */
export const registerDeviceRequest = z.object({
  signPub: key32,
  boxPub: key32,
  pow: z.object({ salt: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), nonce: z.string().regex(/^(0|[1-9][0-9]{0,14})$/) }),
});
export const registerDeviceResponse = z.object({ deviceId: deviceIdSchema });

/** POST /v1/auth/token (auth: Ed25519 signature over `authChallengeBytes`, see auth.ts). */
export const authTokenRequest = z.object({
  aud: z.string().regex(/^https?:\/\/[a-z0-9.\-:[\]]+$/),
  deviceId: deviceIdSchema,
  plugin: pluginIdSchema,
  services: z.array(cloudService).min(1),
  ts: ms,
  nonce: b64urlBytes(16),
  sig: sig64,
});
export const authTokenResponse = z.object({ token: z.string().min(16), expiresAt: ms });

/** Claims inside the bearer token (opaque to clients; the server's own format). */
export const tokenClaims = z.object({ sub: deviceIdSchema, plg: pluginIdSchema, svc: z.array(cloudService), iat: ms, exp: ms });
export type TokenClaims = z.infer<typeof tokenClaims>;

/** DELETE /v1/devices/me (any token of the device) → ok. */
export const deleteDeviceResponse = ok;

// --- store ------------------------------------------------------------------------------

/** GET /v1/store/:key. Namespace = (deviceId, plugin) from the token, never from the path. */
export const storeGetResponse = z.object({ key: storeKeySchema, value: z.unknown(), version: z.number().int().positive(), updatedAt: ms, expiresAt: ms.optional() });
/** PUT /v1/store/:key; optimistic concurrency via `If-Match: <version>` (`0` = must not exist). */
export const storePutRequest = z.object({ value: z.unknown(), ttlS: z.number().int().positive().optional() });
export const storePutResponse = z.object({ version: z.number().int().positive() });
export const storeDeleteResponse = ok;
/** GET /v1/store?prefix= */
export const storeListResponse = z.object({ items: z.array(z.object({ key: storeKeySchema, version: z.number().int().positive(), updatedAt: ms })), cursor: z.string().optional() });

// --- channels (owner) -------------------------------------------------------------------

/** POST /v1/channels */
export const createChannelRequest = z.object({
  ttlS: z.number().int().positive(),
  maxPeers: z.number().int().min(1).default(1),
  /** base64url(sha256(authKey)); see crypto.ts `joinHash`. */
  joinHash: key32,
  /** Sealed with encKey: masked-name hint, PIN required, cap… Opaque to the server. */
  meta: envelopeSchema,
  /** Channel X25519 public key. */
  chanPub: key32,
  /** Viewer page of the calling plugin that `/s/:id` redirects to. */
  page: pageNameSchema.optional(),
});
export const createChannelResponse = z.object({ id: channelIdSchema, expiresAt: ms });

/** PATCH /v1/channels/:id (extend; TTL counted from now, capped at limits.channels.maxTtlS). */
export const patchChannelRequest = z.object({ ttlS: z.number().int().positive() });
export const patchChannelResponse = z.object({ expiresAt: ms });
export const closeChannelResponse = ok;

/** PUT /v1/channels/:id/mailbox/:slot */
export const mailboxPutRequest = z.object({ env: envelopeSchema, ttlS: z.number().int().positive() });
export const mailboxPutResponse = ok;

export const closeReason = z.enum(['owner', 'expired', 'revoked', 'locked', 'server']);

/** Server → owner WebSocket (`GET /v1/channels/:id/ws`). */
export const ownerInFrame = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), id: channelIdSchema, expiresAt: ms, peers: z.array(z.object({ peerId: peerIdSchema, peerPub: key32, joinedAt: ms, online: z.boolean() })) }),
  z.object({ t: z.literal('join'), peerId: peerIdSchema, peerPub: key32, at: ms }),
  z.object({ t: z.literal('leave'), peerId: peerIdSchema, at: ms }),
  z.object({ t: z.literal('msg'), peerId: peerIdSchema, env: envelopeSchema }),
  z.object({ t: z.literal('closed'), reason: closeReason }),
  z.object({ t: z.literal('error'), code: wireErrorCode, message: z.string() }),
  z.object({ t: z.literal('pong'), at: ms }),
]);
export type OwnerInFrame = z.infer<typeof ownerInFrame>;

/** Owner → server. `kick` drops a peer and frees its claim (重置查看者). */
export const ownerOutFrame = z.discriminatedUnion('t', [
  z.object({ t: z.literal('msg'), to: peerIdSchema, env: envelopeSchema }),
  z.object({ t: z.literal('kick'), peerId: peerIdSchema }),
  z.object({ t: z.literal('ping') }),
]);
export type OwnerOutFrame = z.infer<typeof ownerOutFrame>;

// --- channels (public / peer) -----------------------------------------------------------

export const channelStatus = z.enum(['open', 'closed', 'expired']);

/** GET /v1/c/:id (public, rate-limited). */
export const channelInfoResponse = z.object({ status: channelStatus, meta: envelopeSchema, chanPub: key32, expiresAt: ms, ownerOnline: z.boolean() });

/** POST /v1/c/:id/join: claim a seat (maxPeers enforced; `conflict` when full). */
export const joinRequest = z.object({ authKey: key32, peerPub: key32 });
export const joinResponse = z.object({ peerId: peerIdSchema, peerToken: z.string().min(16), expiresAt: ms });

/** Server → peer (WebSocket `GET /v1/c/:id/ws?t=`, or SSE `GET /v1/c/:id/events?t=` `data:` lines). */
export const peerInFrame = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), peerId: peerIdSchema, ownerOnline: z.boolean(), expiresAt: ms }),
  z.object({ t: z.literal('owner'), online: z.boolean() }),
  z.object({ t: z.literal('msg'), env: envelopeSchema }),
  z.object({ t: z.literal('closed'), reason: z.union([closeReason, z.literal('kicked')]) }),
  z.object({ t: z.literal('error'), code: wireErrorCode, message: z.string() }),
  z.object({ t: z.literal('pong'), at: ms }),
]);
export type PeerInFrame = z.infer<typeof peerInFrame>;

/** Peer → server (WebSocket, or the body of `POST /v1/c/:id/send` for SSE clients). */
export const peerOutFrame = z.discriminatedUnion('t', [z.object({ t: z.literal('msg'), env: envelopeSchema }), z.object({ t: z.literal('ping') })]);
export type PeerOutFrame = z.infer<typeof peerOutFrame>;
export const peerSendResponse = ok;

/** GET /v1/c/:id/mailbox (peer token). */
export const mailboxListResponse = z.object({ items: z.array(z.object({ slot: mailboxSlotSchema, env: envelopeSchema, expiresAt: ms })) });

// --- functions & push (stage 6) ---------------------------------------------------------

/** POST /v1/fn/:plugin/:name */
export const functionRequest = z.object({ input: z.unknown(), version: z.number().int().positive().optional() });
export const functionResponse = z.object({ output: z.unknown() });

/** POST /v1/push/tokens */
export const pushTokenRequest = z.object({ kind: z.enum(['unifiedpush', 'apns', 'fcm']), token: z.string().min(1).max(2048) });
/** POST /v1/push/schedule; payloads are envelopes (the server learns the time only). */
export const pushScheduleRequest = z.object({ at: ms, payload: envelopeSchema });
export const pushScheduleResponse = z.object({ id: z.string().min(1) });
/** DELETE /v1/push/schedule */
export const pushCancelRequest = z.object({ id: z.string().min(1) });

// --- paths ------------------------------------------------------------------------------

const enc = encodeURIComponent;

/** Path builders (relative to the provider base URL). */
export const paths = {
  meta: () => '/v1/meta',
  devices: () => '/v1/devices',
  deviceMe: () => '/v1/devices/me',
  authToken: () => '/v1/auth/token',
  storeKey: (key: string) => `/v1/store/${key.split('/').map(enc).join('/')}`,
  storeList: (prefix?: string) => (prefix ? `/v1/store?prefix=${enc(prefix)}` : '/v1/store'),
  channels: () => '/v1/channels',
  channel: (id: string) => `/v1/channels/${enc(id)}`,
  channelWs: (id: string) => `/v1/channels/${enc(id)}/ws`,
  channelMailbox: (id: string) => `/v1/channels/${enc(id)}/mailbox`,
  channelMailboxSlot: (id: string, slot: string) => `/v1/channels/${enc(id)}/mailbox/${enc(slot)}`,
  publicChannel: (id: string) => `/v1/c/${enc(id)}`,
  join: (id: string) => `/v1/c/${enc(id)}/join`,
  peerWs: (id: string, token: string) => `/v1/c/${enc(id)}/ws?t=${enc(token)}`,
  peerEvents: (id: string, token: string) => `/v1/c/${enc(id)}/events?t=${enc(token)}`,
  peerSend: (id: string) => `/v1/c/${enc(id)}/send`,
  peerMailbox: (id: string) => `/v1/c/${enc(id)}/mailbox`,
  fn: (plugin: string, name: string) => `/v1/fn/${enc(plugin)}/${enc(name)}`,
  pushTokens: () => '/v1/push/tokens',
  pushSchedule: () => '/v1/push/schedule',
  shareRedirect: (id: string) => `/s/${enc(id)}`,
  page: (plugin: string, page: string) => `/w/${enc(plugin)}/${enc(page)}`,
} as const;
