# @pku-harness/cloud-server

Reference server for the PKU Harness Cloud protocol v1 (`docs/CLOUD.md` in the app repo):
a blind, end-to-end-encrypted relay and store that every plugin can use through `ctx.cloud`.
Bun + Hono + `bun:sqlite` (WAL). Every request and response is validated with the schemas
in [`@pku-harness/cloud-protocol`](../cloud-protocol), the same file the app and viewer pages use.

What the server can see: device public keys, which plugin stores how many bytes under which
keys, channel timing, viewer IPs. What it can't: store values of e2e plugins, channel meta,
frames (it routes envelopes and never writes or logs them), share-link secrets (the `#k=`
fragment never reaches it). There is no campus identity anywhere.

## Run locally

```bash
cd packages/cloud-server
bun run dev        # http://localhost:8787, reloads on change, data in ./data/cloud.db
bun run start      # same without --watch
bun test           # route tests + real WebSocket/SSE tests on an ephemeral port
```

From the plugins repo root: `bun run --filter @pku-harness/cloud-server dev`.

Android emulator: Settings → 云服务 → 自建 `http://10.0.2.2:8787`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `CLOUD_PUBLIC_URL` | `http://localhost:$PORT` | Origin clients use; the `aud` of signed token challenges |
| `CLOUD_DB` | `./data/cloud.db` | SQLite file (`:memory:` for throwaway runs) |
| `CLOUD_TOKEN_SECRET` | generated, stored in the DB | HMAC key for bearer tokens (≥ 32 chars) |
| `CLOUD_POW_DIFFICULTY` | `16` | Leading zero bits for device registration (≈ 1 s on a phone) |
| `CLOUD_POW_ROTATE_S` | `21600` | PoW salt rotation; the previous salt stays valid one period |
| `CLOUD_OPERATOR_NAME` / `CLOUD_OPERATOR_CONTACT` / `CLOUD_PRIVACY_URL` | self-hosted / empty | Shown by `GET /v1/meta` (Settings → 测试连接) |
| `CLOUD_PAGES_DIR` | `<plugins repo>/plugins` | Folder holding `<plugin>/web/dist` |
| `CLOUD_TRUST_PROXY` | off | `1`: client IP = last `X-Forwarded-For` hop (behind Caddy) |

Limits and quotas are `DEFAULT_LIMITS` from cloud-protocol; rate-limit buckets are in
`src/config.ts` (`defaultConfig`). Tests pass a `Config` directly (e.g. `powDifficulty: 4`).

## Endpoints

| Method / path | Auth | Notes |
|---|---|---|
| `GET /v1/meta` | — | services `store`, `channels`; limits; PoW salt + difficulty; served pages |
| `POST /v1/devices` | PoW | idempotent per signing key |
| `DELETE /v1/devices/me` | device token | wipes store, channels (sockets get `closed: revoked`), nonces |
| `POST /v1/auth/token` | Ed25519 challenge | aud, ±5 min skew, nonce replay → 401; 10-min token for the offered subset of `services` |
| `GET /v1/store?prefix=` · `GET/PUT/DELETE /v1/store/:key` | token with `store` | namespace = token's (device, plugin); `If-Match: <version>` (`0` = create only), `ETag`, `ttlS`; 1 MB / 1000 keys / 64 KB per value |
| `POST /v1/channels` | token with `channels` | ttl 60 s–24 h, `maxPeers` ≤ 5, `page` must be served for the token's plugin, ≤ 5 open per device |
| `PATCH /v1/channels/:id` · `DELETE /v1/channels/:id` | owner | extend (from now, capped at 24 h; peers get `extended`) · close |
| `GET /v1/channels/:id/ws` | owner (`Authorization`, or `?t=`) | owner WebSocket |
| `PUT/DELETE /v1/channels/:id/mailbox/:slot` · `DELETE /v1/channels/:id/mailbox` | owner | sealed blobs, ≤ 64 slots, never outlive the channel |
| `GET /v1/c/:id` | — (per-IP limit) | status, sealed meta, chanPub, ownerOnline |
| `POST /v1/c/:id/join` | `authKey` | claim a seat (409 when full); 5 wrong keys lock the channel |
| `GET /v1/c/:id/ws?t=` · `GET /v1/c/:id/events?t=` · `POST /v1/c/:id/send` | peer token | peer WebSocket, or SSE + POST for webviews without WebSocket |
| `GET /v1/c/:id/mailbox` | peer token | |
| `POST /v1/fn/*` · `/v1/push/*` | — | `501 unsupported` until stage 6 |
| `GET /w/:plugin/*` | — | `<plugin>/web/dist`, strict CSP, `Referrer-Policy: no-referrer` |
| `GET /s/:id` | — | `302 /w/<plugin>/<page>?c=<id>`; the browser keeps `#k=…` across the redirect |
| `GET /healthz` | — | liveness |

Errors are always `errorBody` (`{ error: { code, message, retryAfterS? } }`). Rate-limited
responses are 429 with `Retry-After`; limited endpoints carry `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset` and `RateLimit-Policy`.

### Viewer pages

A plugin's page `view` is `web/dist/view.html` (or `web/dist/view/index.html`); assets are
served by relative path. The CSP allows only same-origin scripts, styles (plus inline styles),
images (plus `data:`) and connections, so a page can talk to this server and nothing else.
After `/s/<id>` the page is at `/w/<plugin>/<page>?c=<id>#k=<secret>`: read the channel id
from `?c` and the key from the fragment (`parseKeyFragment`).

### Sockets

WebSocket close codes: `4003` kicked, `4009` replaced by a newer connection of the same
party, `4010` channel closed/expired (a `closed` frame comes first), `1001` server shutdown
(channels persist; reconnect). Frames are capped at `frameBytes` of ciphertext and
`framesPerMin` per party (the owner gets `framesPerMin × maxPeers`); violations get an
`error` frame and the frame is dropped. A frame to an offline party is dropped with
`error: conflict`; use the mailbox for offline delivery.

## Layout

```
src/index.ts          Bun.serve + websocket handlers, env config
src/app.ts            Hono app, middleware (IP, rate-limit headers, body limit, logging)
src/routes/*.ts       meta, devices, auth, store, channels, peer, mailbox, fn, push
src/auth/             token.ts (HMAC bearer tokens), pow.ts (salt rotation), sig.ts (nonce replay)
src/db/               schema.sql, storage.ts (interface), sqlite.ts
src/limits.ts         token buckets
src/channels/hub.ts   live sockets, presence, kick/close, GC loop
src/pages.ts          /w/<plugin>/* and /s/:id
deploy/               Dockerfile, Caddyfile, litestream.yml
```

Deployment: [`deploy/README.md`](deploy/README.md).
