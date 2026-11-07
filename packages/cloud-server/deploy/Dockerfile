# PKU Harness Cloud reference server.
# Build from the plugins repo root (the server imports workspace packages and serves the viewer
# pages plugins/*/web/dist, which the `pages` stage builds from source):
#   docker build -f packages/cloud-server/deploy/Dockerfile -t pku-harness-cloud .
FROM litestream/litestream:0.3.13 AS litestream

# Every plugin's viewer page, built here so a fresh server never lacks one (channels with
# page: 'view' are refused until the page exists). Collected into /out/<plugin>/web/dist.
FROM oven/bun:1.4.3-alpine AS pages
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile && mkdir -p /out \
  && for web in plugins/*/web; do \
       [ -f "$web/package.json" ] || continue; \
       (cd "$web" && bun install --frozen-lockfile && bun run build) || exit 1; \
       mkdir -p "/out/${web#plugins/}" && cp -r "$web/dist" "/out/${web#plugins/}/dist"; \
     done

FROM oven/bun:1.4.3-alpine
WORKDIR /app
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY . .
COPY --from=pages /out/ ./plugins/
RUN bun install --frozen-lockfile --production --filter @pku-harness/cloud-server \
  && mkdir -p /data && chown bun:bun /data
COPY packages/cloud-server/deploy/litestream.yml /etc/litestream.yml

USER bun
ENV PORT=8787 \
    HOST=0.0.0.0 \
    CLOUD_DB=/data/cloud.db \
    CLOUD_TRUST_PROXY=1
EXPOSE 8787
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1

# With LITESTREAM_REPLICA_URL set: restore the database if this volume is empty, then run the
# server under `litestream replicate`. Without it: run the server directly.
CMD ["sh", "-c", "if [ -n \"$LITESTREAM_REPLICA_URL\" ]; then litestream restore -if-db-not-exists -if-replica-exists -config /etc/litestream.yml \"$CLOUD_DB\" && exec litestream replicate -config /etc/litestream.yml -exec 'bun packages/cloud-server/src/index.ts'; else exec bun packages/cloud-server/src/index.ts; fi"]
