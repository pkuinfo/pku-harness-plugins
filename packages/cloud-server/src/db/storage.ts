/**
 * Persistence boundary. `SqliteStorage` (bun:sqlite, WAL) is the reference implementation;
 * Postgres can come later behind the same interface. Methods are async so a networked
 * database fits; anything that must be atomic (version checks, quotas, claims) is one method
 * so implementations can run it in a single transaction.
 */
import type { Envelope } from '@pku-harness/cloud-protocol';

export interface DeviceRow {
  id: string;
  signPub: string;
  boxPub: string;
  createdAt: number;
}

export interface Namespace {
  deviceId: string;
  plugin: string;
}

export interface StoreRow {
  key: string;
  /** JSON text exactly as the client sent it. */
  value: string;
  version: number;
  updatedAt: number;
  expiresAt?: number;
}

export type StorePutResult = { ok: true; version: number } | { ok: false; reason: 'conflict' | 'quota_keys' | 'quota_bytes' };

export type ChannelStatus = 'open' | 'closed' | 'expired';

export interface ChannelRow {
  id: string;
  deviceId: string;
  plugin: string;
  joinHash: string;
  chanPub: string;
  meta: Envelope;
  page?: string;
  maxPeers: number;
  createdAt: number;
  expiresAt: number;
  status: ChannelStatus;
  closeReason?: string;
  closedAt?: number;
  failedJoins: number;
}

export interface PeerRow {
  channelId: string;
  peerId: string;
  peerPub: string;
  joinedAt: number;
}

export interface MailboxRow {
  slot: string;
  env: Envelope;
  expiresAt: number;
}

export interface Storage {
  getSetting(name: string): Promise<string | undefined>;
  setSetting(name: string, value: string): Promise<void>;

  /** Insert, or return the existing device with the same signPub (idempotent registration). */
  createDevice(row: DeviceRow): Promise<DeviceRow>;
  getDevice(id: string): Promise<DeviceRow | undefined>;
  /** Delete the device and everything it owns. Returns the ids of channels that were open. */
  deleteDevice(id: string): Promise<{ openChannels: string[] }>;
  /** Remember a challenge nonce; false when it was already used. */
  useNonce(deviceId: string, nonce: string, expiresAt: number): Promise<boolean>;

  storeGet(ns: Namespace, key: string, now: number): Promise<StoreRow | undefined>;
  /** `ifVersion`: 0 = must not exist; n = current version must be n. */
  storePut(
    ns: Namespace,
    key: string,
    value: string,
    opts: { now: number; ifVersion?: number; expiresAt?: number; maxKeys: number; maxBytes: number },
  ): Promise<StorePutResult>;
  storeDelete(ns: Namespace, key: string, opts: { now: number; ifVersion?: number }): Promise<'ok' | 'missing' | 'conflict'>;
  storeList(ns: Namespace, prefix: string, now: number, limit: number): Promise<StoreRow[]>;

  /** Insert unless the device already has `maxOpen` open, unexpired channels. */
  createChannel(row: ChannelRow, maxOpen: number): Promise<boolean>;
  getChannel(id: string): Promise<ChannelRow | undefined>;
  setChannelExpiry(id: string, expiresAt: number): Promise<void>;
  /** Mark closed/expired and drop its peers and mailbox. False when it wasn't open. */
  closeChannel(id: string, status: Exclude<ChannelStatus, 'open'>, reason: string, now: number): Promise<boolean>;
  /** Increment and return the failed-join counter. */
  failJoin(id: string): Promise<number>;

  /** Claim a seat unless `maxPeers` are already claimed. */
  claimPeer(row: PeerRow, maxPeers: number): Promise<boolean>;
  getPeer(channelId: string, peerId: string): Promise<PeerRow | undefined>;
  listPeers(channelId: string): Promise<PeerRow[]>;
  removePeer(channelId: string, peerId: string): Promise<boolean>;

  /** Insert/replace a slot unless that would exceed `maxSlots`. */
  mailboxPut(channelId: string, row: MailboxRow, maxSlots: number, now: number): Promise<boolean>;
  mailboxDelete(channelId: string, slot: string): Promise<void>;
  mailboxClear(channelId: string): Promise<void>;
  mailboxList(channelId: string, now: number): Promise<MailboxRow[]>;

  /**
   * Sweep: mark open channels past their expiry as expired (returned, so sockets can be told),
   * delete channels closed longer than `closedRetentionMs`, expired store keys, mailbox slots
   * and nonces.
   */
  gc(now: number, closedRetentionMs: number): Promise<{ expired: string[] }>;
  close(): void;
}
