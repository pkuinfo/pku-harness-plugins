/**
 * Server configuration. Everything has a safe default; `configFromEnv()` maps the documented
 * environment variables (see README.md) onto it, and tests build a `Config` directly.
 */
import { resolve } from 'node:path';

import { DEFAULT_LIMITS, DEFAULT_POW_DIFFICULTY, type Limits, normaliseAudience } from '@pku-harness/cloud-protocol';

/** A token bucket: `limit` requests per `windowS`, refilled continuously. */
export interface Rate {
  limit: number;
  windowS: number;
}

export interface RateConfig {
  /** Every request, per client IP. */
  ip: Rate;
  /** POST /v1/devices, per IP (PoW is the main cost; this caps bursts). */
  register: Rate;
  /** POST /v1/auth/token, per device. */
  token: Rate;
  /** Store requests, per (device, plugin). */
  store: Rate;
  /** Owner channel requests (create, extend, close, mailbox), per (device, plugin). */
  channels: Rate;
  /** GET /v1/c/:id, per IP. */
  publicInfo: Rate;
  /** POST /v1/c/:id/join, per IP (limits.joinsPerIpPerMin). */
  joins: Rate;
  /** Peer HTTP endpoints (send, mailbox, events), per (channel, peer). */
  peer: Rate;
}

export interface Config {
  /** Public origin clients use (`aud` of signed challenges). */
  publicURL: string;
  port: number;
  hostname: string;
  /** SQLite file path, or `:memory:`. */
  dbPath: string;
  /** HMAC secret for bearer tokens. Undefined: generated at first start and stored in the DB. */
  tokenSecret?: string;
  powDifficulty: number;
  /** Rotate the PoW salt this often (the previous salt stays valid for one more period). */
  powRotateS: number;
  limits: Limits;
  rates: RateConfig;
  operator: { name: string; contact: string; privacyURL?: string };
  /** Directory holding plugin folders (`<dir>/<plugin>/web/dist`). */
  pagesDir: string;
  /** Take the client IP from the first `X-Forwarded-For` hop (behind Caddy). */
  trustProxy: boolean;
  /** How often expired channels, store keys, mailbox slots and nonces are swept. */
  gcIntervalMs: number;
  /** Closed/expired channels stay readable (`status: closed`) this long before they 404. */
  closedRetentionMs: number;
  /** Failed joins before a channel locks. */
  maxFailedJoins: number;
  /** SSE heartbeat interval. */
  sseHeartbeatMs: number;
  /** Max request body for JSON endpoints. */
  maxBodyBytes: number;
}

const perMin = (limit: number): Rate => ({ limit, windowS: 60 });

export function defaultConfig(overrides: Partial<Omit<Config, 'rates'>> & { rates?: Partial<RateConfig> } = {}): Config {
  const port = overrides.port ?? 8787;
  const limits = overrides.limits ?? DEFAULT_LIMITS;
  return {
    publicURL: `http://localhost:${port}`,
    port,
    hostname: '0.0.0.0',
    dbPath: './data/cloud.db',
    powDifficulty: DEFAULT_POW_DIFFICULTY,
    powRotateS: 6 * 3600,
    limits,
    operator: { name: 'PKU Harness Cloud (self-hosted)', contact: '' },
    pagesDir: resolve(import.meta.dir, '../../../plugins'),
    trustProxy: false,
    gcIntervalMs: 15_000,
    closedRetentionMs: 3600_000,
    maxFailedJoins: 5,
    sseHeartbeatMs: 15_000,
    maxBodyBytes: 128 * 1024,
    ...overrides,
    rates: { ...defaultRates(limits), ...overrides.rates },
  };
}

function defaultRates(limits: Limits): RateConfig {
  return {
    ip: perMin(600),
    register: { limit: 10, windowS: 3600 },
    token: perMin(60),
    store: perMin(120),
    channels: perMin(60),
    publicInfo: perMin(60),
    joins: perMin(limits.joinsPerIpPerMin),
    peer: perMin(120),
  };
}

function int(v: string | undefined, name: string): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

/** Environment variables → Config (documented in README.md). */
export function configFromEnv(env: Record<string, string | undefined> = process.env): Config {
  const port = int(env.PORT, 'PORT') ?? 8787;
  const publicURL = normaliseAudience(env.CLOUD_PUBLIC_URL ?? `http://localhost:${port}`);
  const secret = env.CLOUD_TOKEN_SECRET;
  if (secret !== undefined && secret.length < 32) throw new Error('CLOUD_TOKEN_SECRET must be at least 32 characters');
  const base = defaultConfig({ port });
  return {
    ...base,
    publicURL,
    hostname: env.HOST ?? base.hostname,
    dbPath: env.CLOUD_DB ?? base.dbPath,
    tokenSecret: secret || undefined,
    powDifficulty: int(env.CLOUD_POW_DIFFICULTY, 'CLOUD_POW_DIFFICULTY') ?? base.powDifficulty,
    powRotateS: int(env.CLOUD_POW_ROTATE_S, 'CLOUD_POW_ROTATE_S') ?? base.powRotateS,
    operator: {
      name: env.CLOUD_OPERATOR_NAME || base.operator.name,
      contact: env.CLOUD_OPERATOR_CONTACT ?? '',
      ...(env.CLOUD_PRIVACY_URL ? { privacyURL: env.CLOUD_PRIVACY_URL } : {}),
    },
    pagesDir: env.CLOUD_PAGES_DIR ? resolve(env.CLOUD_PAGES_DIR) : base.pagesDir,
    trustProxy: env.CLOUD_TRUST_PROXY === '1' || env.CLOUD_TRUST_PROXY === 'true',
  };
}
