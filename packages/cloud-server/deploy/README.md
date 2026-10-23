# Deploying the cloud server

Three pieces, all optional except the first:

| File | Role |
|---|---|
| `Dockerfile` | Bun image running `packages/cloud-server`, with Litestream bundled. Data in `/data`. |
| `Caddyfile` | HTTPS, HTTP/2, WebSocket and SSE proxying. Sets `X-Forwarded-For`, which the server trusts with `CLOUD_TRUST_PROXY=1`. |
| `litestream.yml` | Continuous replication of the SQLite file to S3/SFTP/…; used when `LITESTREAM_REPLICA_URL` is set. |

## Build

From the root of the plugins repo, after building any viewer pages (`plugins/*/web/dist`):

```bash
docker build -f packages/cloud-server/deploy/Dockerfile -t pku-harness-cloud .
```

## Run

```bash
docker run -d --name cloud --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v cloud-data:/data \
  -e CLOUD_PUBLIC_URL=https://s.example.org \
  -e CLOUD_OPERATOR_NAME='pkuinfo' -e CLOUD_OPERATOR_CONTACT='ops@example.org' \
  -e CLOUD_PRIVACY_URL=https://example.org/privacy \
  -e LITESTREAM_REPLICA_URL=s3://bucket/pku-harness-cloud \
  -e LITESTREAM_ACCESS_KEY_ID=… -e LITESTREAM_SECRET_ACCESS_KEY=… \
  pku-harness-cloud

CLOUD_DOMAIN=s.example.org caddy run --config packages/cloud-server/deploy/Caddyfile
```

`CLOUD_PUBLIC_URL` must be the exact origin clients use: it is the audience of signed token
challenges, so a wrong value rejects every login (`401 wrong audience`).

The token secret is generated on first start and kept in the database (so it is replicated
with it). Set `CLOUD_TOKEN_SECRET` (≥ 32 chars) instead to manage it yourself; changing it
only invalidates live 10-minute tokens.

## Operations

- **Backups/restore:** with Litestream configured, an empty volume is restored from the replica
  on start. Without it, copy `/data/cloud.db` with `sqlite3 cloud.db ".backup out.db"`.
- **Logs:** one JSON line per request with method, route pattern, status and timing. They never
  contain bodies, frames, tokens, store keys or query strings. Keep the proxy's access log off
  (see the Caddyfile) or strip query strings if you enable it.
- **Scaling:** one process. Channel sockets live in memory, so don't run replicas behind a load
  balancer without sticky routing per channel.
- **Restart:** channels, seats and mailboxes persist; clients reconnect their sockets.
