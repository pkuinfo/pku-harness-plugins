-- PKU Harness Cloud reference server, SQLite schema (idempotent).
-- Nothing here is plaintext user content: store values and mailbox blobs are whatever the
-- client sent (envelopes when the plugin is e2e), channel meta is an envelope, and frames are
-- never written at all. Times are Unix milliseconds.

CREATE TABLE IF NOT EXISTS settings (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,
  sign_pub   TEXT NOT NULL UNIQUE,
  box_pub    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Signed-challenge nonces, remembered for the clock-skew window (replay protection).
CREATE TABLE IF NOT EXISTS auth_nonces (
  device_id  TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, nonce)
);
CREATE INDEX IF NOT EXISTS auth_nonces_exp ON auth_nonces (expires_at);

-- KV store, namespaced by (device, plugin) from the bearer token.
CREATE TABLE IF NOT EXISTS store (
  device_id  TEXT NOT NULL,
  plugin     TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  size       INTEGER NOT NULL,
  version    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (device_id, plugin, key)
);
CREATE INDEX IF NOT EXISTS store_exp ON store (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS channels (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL,
  plugin       TEXT NOT NULL,
  join_hash    TEXT NOT NULL,
  chan_pub     TEXT NOT NULL,
  meta         TEXT NOT NULL,
  page         TEXT,
  max_peers    INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  close_reason TEXT,
  closed_at    INTEGER,
  failed_joins INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS channels_device ON channels (device_id, status);
CREATE INDEX IF NOT EXISTS channels_exp ON channels (status, expires_at);

CREATE TABLE IF NOT EXISTS peers (
  channel_id TEXT NOT NULL,
  peer_id    TEXT NOT NULL,
  peer_pub   TEXT NOT NULL,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (channel_id, peer_id)
);

CREATE TABLE IF NOT EXISTS mailbox (
  channel_id TEXT NOT NULL,
  slot       TEXT NOT NULL,
  env        TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, slot)
);
CREATE INDEX IF NOT EXISTS mailbox_exp ON mailbox (expires_at);
