/** `Storage` on bun:sqlite with WAL. Litestream can replicate the file (deploy/litestream.yml). */
import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Envelope } from '@pku-harness/cloud-protocol';

import type { ChannelRow, ChannelStatus, DeviceRow, MailboxRow, Namespace, PeerRow, Storage, StorePutResult, StoreRow } from './storage';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

interface ChannelDb {
  id: string;
  device_id: string;
  plugin: string;
  join_hash: string;
  chan_pub: string;
  meta: string;
  page: string | null;
  max_peers: number;
  created_at: number;
  expires_at: number;
  status: ChannelStatus;
  close_reason: string | null;
  closed_at: number | null;
  failed_joins: number;
}

const toChannel = (r: ChannelDb): ChannelRow => ({
  id: r.id,
  deviceId: r.device_id,
  plugin: r.plugin,
  joinHash: r.join_hash,
  chanPub: r.chan_pub,
  meta: JSON.parse(r.meta) as Envelope,
  ...(r.page ? { page: r.page } : {}),
  maxPeers: r.max_peers,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  status: r.status,
  ...(r.close_reason ? { closeReason: r.close_reason } : {}),
  ...(r.closed_at !== null ? { closedAt: r.closed_at } : {}),
  failedJoins: r.failed_joins,
});

interface StoreDb {
  key: string;
  value: string;
  version: number;
  updated_at: number;
  expires_at: number | null;
}
const toStore = (r: StoreDb): StoreRow => ({
  key: r.key,
  value: r.value,
  version: r.version,
  updatedAt: r.updated_at,
  ...(r.expires_at !== null ? { expiresAt: r.expires_at } : {}),
});

/** Escape LIKE wildcards; used with `ESCAPE '\'`. */
const likePrefix = (p: string) => `${p.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export class SqliteStorage implements Storage {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA synchronous = NORMAL');
    this.db.run('PRAGMA busy_timeout = 5000');
    this.db.run(SCHEMA);
  }

  async getSetting(name: string) {
    return this.db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE name = ?').get(name)?.value;
  }
  async setSetting(name: string, value: string) {
    this.db.query('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(name, value);
  }

  async createDevice(row: DeviceRow) {
    return this.db.transaction(() => {
      const existing = this.db
        .query<{ id: string; box_pub: string; created_at: number }, [string]>('SELECT id, box_pub, created_at FROM devices WHERE sign_pub = ?')
        .get(row.signPub);
      if (existing) return { id: existing.id, signPub: row.signPub, boxPub: existing.box_pub, createdAt: existing.created_at };
      this.db.query('INSERT INTO devices (id, sign_pub, box_pub, created_at) VALUES (?, ?, ?, ?)').run(row.id, row.signPub, row.boxPub, row.createdAt);
      return row;
    })();
  }
  async getDevice(id: string) {
    const r = this.db
      .query<{ id: string; sign_pub: string; box_pub: string; created_at: number }, [string]>('SELECT * FROM devices WHERE id = ?')
      .get(id);
    return r ? { id: r.id, signPub: r.sign_pub, boxPub: r.box_pub, createdAt: r.created_at } : undefined;
  }
  async deleteDevice(id: string) {
    return this.db.transaction(() => {
      const open = this.db.query<{ id: string }, [string]>("SELECT id FROM channels WHERE device_id = ? AND status = 'open'").all(id).map((r) => r.id);
      const owned = 'SELECT id FROM channels WHERE device_id = ?';
      this.db.query(`DELETE FROM peers WHERE channel_id IN (${owned})`).run(id);
      this.db.query(`DELETE FROM mailbox WHERE channel_id IN (${owned})`).run(id);
      this.db.query('DELETE FROM channels WHERE device_id = ?').run(id);
      this.db.query('DELETE FROM store WHERE device_id = ?').run(id);
      this.db.query('DELETE FROM auth_nonces WHERE device_id = ?').run(id);
      this.db.query('DELETE FROM devices WHERE id = ?').run(id);
      return { openChannels: open };
    })();
  }
  async useNonce(deviceId: string, nonce: string, expiresAt: number) {
    const r = this.db.query('INSERT OR IGNORE INTO auth_nonces (device_id, nonce, expires_at) VALUES (?, ?, ?)').run(deviceId, nonce, expiresAt);
    return r.changes === 1;
  }

  async storeGet(ns: Namespace, key: string, now: number) {
    const r = this.db
      .query<StoreDb, [string, string, string, number]>(
        'SELECT key, value, version, updated_at, expires_at FROM store WHERE device_id = ? AND plugin = ? AND key = ? AND (expires_at IS NULL OR expires_at > ?)',
      )
      .get(ns.deviceId, ns.plugin, key, now);
    return r ? toStore(r) : undefined;
  }

  async storePut(
    ns: Namespace,
    key: string,
    value: string,
    opts: { now: number; ifVersion?: number; expiresAt?: number; maxKeys: number; maxBytes: number },
  ): Promise<StorePutResult> {
    const size = Buffer.byteLength(value, 'utf8');
    return this.db.transaction((): StorePutResult => {
      const { deviceId, plugin } = ns;
      // Expired rows count as absent.
      this.db.query('DELETE FROM store WHERE device_id = ? AND plugin = ? AND expires_at IS NOT NULL AND expires_at <= ?').run(deviceId, plugin, opts.now);
      const cur = this.db
        .query<{ version: number; size: number }, [string, string, string]>('SELECT version, size FROM store WHERE device_id = ? AND plugin = ? AND key = ?')
        .get(deviceId, plugin, key);
      if (opts.ifVersion !== undefined && (cur?.version ?? 0) !== opts.ifVersion) return { ok: false, reason: 'conflict' };
      const totals = this.db
        .query<{ n: number; bytes: number | null }, [string, string]>('SELECT COUNT(*) AS n, SUM(size) AS bytes FROM store WHERE device_id = ? AND plugin = ?')
        .get(deviceId, plugin)!;
      if (!cur && totals.n >= opts.maxKeys) return { ok: false, reason: 'quota_keys' };
      if ((totals.bytes ?? 0) - (cur?.size ?? 0) + size > opts.maxBytes) return { ok: false, reason: 'quota_bytes' };
      const version = (cur?.version ?? 0) + 1;
      this.db
        .query(
          `INSERT INTO store (device_id, plugin, key, value, size, version, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(device_id, plugin, key) DO UPDATE SET value = excluded.value, size = excluded.size, version = excluded.version,
             updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
        )
        .run(deviceId, plugin, key, value, size, version, opts.now, opts.expiresAt ?? null);
      return { ok: true, version };
    })();
  }

  async storeDelete(ns: Namespace, key: string, opts: { now: number; ifVersion?: number }) {
    return this.db.transaction((): 'ok' | 'missing' | 'conflict' => {
      const cur = this.db
        .query<{ version: number }, [string, string, string, number]>(
          'SELECT version FROM store WHERE device_id = ? AND plugin = ? AND key = ? AND (expires_at IS NULL OR expires_at > ?)',
        )
        .get(ns.deviceId, ns.plugin, key, opts.now);
      if (opts.ifVersion !== undefined && (cur?.version ?? 0) !== opts.ifVersion) return 'conflict';
      if (!cur) return 'missing';
      this.db.query('DELETE FROM store WHERE device_id = ? AND plugin = ? AND key = ?').run(ns.deviceId, ns.plugin, key);
      return 'ok';
    })();
  }

  async storeList(ns: Namespace, prefix: string, now: number, limit: number) {
    return this.db
      .query<StoreDb, [string, string, string, number, number]>(
        `SELECT key, value, version, updated_at, expires_at FROM store
         WHERE device_id = ? AND plugin = ? AND key LIKE ? ESCAPE '\\' AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY key LIMIT ?`,
      )
      .all(ns.deviceId, ns.plugin, likePrefix(prefix), now, limit)
      .map(toStore);
  }

  async createChannel(row: ChannelRow, maxOpen: number) {
    return this.db.transaction(() => {
      const { n } = this.db
        .query<{ n: number }, [string, number]>("SELECT COUNT(*) AS n FROM channels WHERE device_id = ? AND status = 'open' AND expires_at > ?")
        .get(row.deviceId, row.createdAt)!;
      if (n >= maxOpen) return false;
      this.db
        .query(
          `INSERT INTO channels (id, device_id, plugin, join_hash, chan_pub, meta, page, max_peers, created_at, expires_at, status, failed_joins)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0)`,
        )
        .run(row.id, row.deviceId, row.plugin, row.joinHash, row.chanPub, JSON.stringify(row.meta), row.page ?? null, row.maxPeers, row.createdAt, row.expiresAt);
      return true;
    })();
  }
  async getChannel(id: string) {
    const r = this.db.query<ChannelDb, [string]>('SELECT * FROM channels WHERE id = ?').get(id);
    return r ? toChannel(r) : undefined;
  }
  async setChannelExpiry(id: string, expiresAt: number) {
    this.db.query('UPDATE channels SET expires_at = ? WHERE id = ?').run(expiresAt, id);
  }
  async closeChannel(id: string, status: Exclude<ChannelStatus, 'open'>, reason: string, now: number) {
    return this.db.transaction(() => {
      const r = this.db.query("UPDATE channels SET status = ?, close_reason = ?, closed_at = ? WHERE id = ? AND status = 'open'").run(status, reason, now, id);
      this.db.query('DELETE FROM peers WHERE channel_id = ?').run(id);
      this.db.query('DELETE FROM mailbox WHERE channel_id = ?').run(id);
      return r.changes === 1;
    })();
  }
  async failJoin(id: string) {
    return (
      this.db.query<{ failed_joins: number }, [string]>('UPDATE channels SET failed_joins = failed_joins + 1 WHERE id = ? RETURNING failed_joins').get(id)
        ?.failed_joins ?? 0
    );
  }

  async claimPeer(row: PeerRow, maxPeers: number) {
    return this.db.transaction(() => {
      const { n } = this.db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM peers WHERE channel_id = ?').get(row.channelId)!;
      if (n >= maxPeers) return false;
      this.db.query('INSERT INTO peers (channel_id, peer_id, peer_pub, joined_at) VALUES (?, ?, ?, ?)').run(row.channelId, row.peerId, row.peerPub, row.joinedAt);
      return true;
    })();
  }
  async getPeer(channelId: string, peerId: string) {
    const r = this.db
      .query<{ peer_pub: string; joined_at: number }, [string, string]>('SELECT peer_pub, joined_at FROM peers WHERE channel_id = ? AND peer_id = ?')
      .get(channelId, peerId);
    return r ? { channelId, peerId, peerPub: r.peer_pub, joinedAt: r.joined_at } : undefined;
  }
  async listPeers(channelId: string) {
    return this.db
      .query<{ peer_id: string; peer_pub: string; joined_at: number }, [string]>('SELECT peer_id, peer_pub, joined_at FROM peers WHERE channel_id = ? ORDER BY joined_at')
      .all(channelId)
      .map((r) => ({ channelId, peerId: r.peer_id, peerPub: r.peer_pub, joinedAt: r.joined_at }));
  }
  async removePeer(channelId: string, peerId: string) {
    return this.db.query('DELETE FROM peers WHERE channel_id = ? AND peer_id = ?').run(channelId, peerId).changes === 1;
  }

  async mailboxPut(channelId: string, row: MailboxRow, maxSlots: number, now: number) {
    return this.db.transaction(() => {
      this.db.query('DELETE FROM mailbox WHERE channel_id = ? AND expires_at <= ?').run(channelId, now);
      const exists = this.db.query('SELECT 1 FROM mailbox WHERE channel_id = ? AND slot = ?').get(channelId, row.slot);
      if (!exists) {
        const { n } = this.db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM mailbox WHERE channel_id = ?').get(channelId)!;
        if (n >= maxSlots) return false;
      }
      this.db
        .query(
          'INSERT INTO mailbox (channel_id, slot, env, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, slot) DO UPDATE SET env = excluded.env, expires_at = excluded.expires_at',
        )
        .run(channelId, row.slot, JSON.stringify(row.env), row.expiresAt);
      return true;
    })();
  }
  async mailboxDelete(channelId: string, slot: string) {
    this.db.query('DELETE FROM mailbox WHERE channel_id = ? AND slot = ?').run(channelId, slot);
  }
  async mailboxClear(channelId: string) {
    this.db.query('DELETE FROM mailbox WHERE channel_id = ?').run(channelId);
  }
  async mailboxList(channelId: string, now: number) {
    return this.db
      .query<{ slot: string; env: string; expires_at: number }, [string, number]>(
        'SELECT slot, env, expires_at FROM mailbox WHERE channel_id = ? AND expires_at > ? ORDER BY slot',
      )
      .all(channelId, now)
      .map((r) => ({ slot: r.slot, env: JSON.parse(r.env) as Envelope, expiresAt: r.expires_at }));
  }

  async gc(now: number, closedRetentionMs: number) {
    return this.db.transaction(() => {
      const expired = this.db
        .query<{ id: string }, [number, number]>("UPDATE channels SET status = 'expired', close_reason = 'expired', closed_at = ? WHERE status = 'open' AND expires_at <= ? RETURNING id")
        .all(now, now)
        .map((r) => r.id);
      const stale = "SELECT id FROM channels WHERE status != 'open'";
      this.db.query(`DELETE FROM peers WHERE channel_id IN (${stale})`).run();
      this.db.query(`DELETE FROM mailbox WHERE channel_id IN (${stale}) OR expires_at <= ?`).run(now);
      this.db.query("DELETE FROM channels WHERE status != 'open' AND closed_at <= ?").run(now - closedRetentionMs);
      this.db.query('DELETE FROM store WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
      this.db.query('DELETE FROM auth_nonces WHERE expires_at <= ?').run(now);
      return { expired };
    })();
  }

  close() {
    this.db.close();
  }
}
