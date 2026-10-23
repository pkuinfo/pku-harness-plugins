/**
 * Server configuration. Everything has a safe default; `configFromEnv()` maps the documented
 * environment variables (see README.md) onto it, and tests build a `Config` directly.
 */
import { resolve } from 'node:path';

import { DEFAULT_LIMITS, DEFAULT_POW_DIFFICULTY, type FunctionPolicy, type Limits, functionPolicySchema, normaliseAudience } from '@pku-harness/cloud-protocol';

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
  /** POST /v1/fn, per (device, plugin) (limits.functions.callsPerMin). */
  fn: Rate;
  /** GET|POST /v1/p (public functions), per IP. */
  fnPublic: Rate;
}

/** Plugin server functions (docs/CLOUD-FUNCTIONS.md; README.md § Server functions). */
export interface FunctionsConfig {
  /** Which plugins may run: registry-pinned hashes, the operator's list, or any document. */
  policy: FunctionPolicy;
  /** `CLOUD_FN_ALLOW` entries: `plugin@<hash>`, `plugin@*`, optionally `=<link>` (for /v1/p). */
  allow: string[];
  /** `CLOUD_FN_VERIFIED`: JSON `{ "<plugin>": ["<hash>", …] | { "link": "…", "hashes": [...] } }`. */
  verifiedFile?: string;
  /** `CLOUD_FN_LOCAL`: a folder of plugin folders (`<dir>/<id>/PLUGIN.md`) used instead of fetching. */
  localDir?: string;
  /** Operator secrets by env name (`CLOUD_SECRET_<PLUGIN_ID_UPPER_SNAKE>__<NAME>`). */
  secrets: Record<string, string>;
  /** Per plugin per day. */
  callsPerDay: number;
  requestsPerDay: number;
  /** Per-run limits (docs/CLOUD-FUNCTIONS.md §3.3); a document's `server.limits` can only lower them. */
  run: { steps: number; requests: number; wallMs: number; ops: number; resultBytes: number; responseBytes: number };
  maxInputBytes: number;
  /** Compiled documents kept (LRU). */
  docCacheSize: number;
  /** Public-function results kept (TTL from the function's `cache`). */
  publicCacheSize: number;
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
  functions: FunctionsConfig;
}

const perMin = (limit: number): Rate => ({ limit, windowS: 60 });

export function defaultFunctions(env: Record<string, string | undefined> = process.env): FunctionsConfig {
  return {
    policy: env.NODE_ENV === 'production' ? 'allowlist' : 'open',
    allow: [],
    secrets: {},
    callsPerDay: 50_000,
    requestsPerDay: 20_000,
    run: { steps: 100, requests: 20, wallMs: 10_000, ops: 50_000, resultBytes: 256_000, responseBytes: 2_000_000 },
    maxInputBytes: 64 * 1024,
    docCacheSize: 64,
    publicCacheSize: 500,
  };
}

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
    functions: defaultFunctions(),
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
    fn: perMin(limits.functions?.callsPerMin ?? 60),
    fnPublic: perMin(60),
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
    functions: functionsFromEnv(env),
  };
}

function functionsFromEnv(env: Record<string, string | undefined>): FunctionsConfig {
  const base = defaultFunctions(env);
  const policy = env.CLOUD_FN_POLICY ? functionPolicySchema.safeParse(env.CLOUD_FN_POLICY) : undefined;
  if (policy && !policy.success) throw new Error('CLOUD_FN_POLICY must be verified, allowlist or open');
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith('CLOUD_SECRET_') && v) secrets[k] = v;
  return {
    ...base,
    policy: policy?.data ?? base.policy,
    allow: (env.CLOUD_FN_ALLOW ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    verifiedFile: env.CLOUD_FN_VERIFIED ? resolve(env.CLOUD_FN_VERIFIED) : undefined,
    localDir: env.CLOUD_FN_LOCAL ? resolve(env.CLOUD_FN_LOCAL) : undefined,
    secrets,
    callsPerDay: int(env.CLOUD_FN_CALLS_PER_DAY, 'CLOUD_FN_CALLS_PER_DAY') ?? base.callsPerDay,
    requestsPerDay: int(env.CLOUD_FN_REQUESTS_PER_DAY, 'CLOUD_FN_REQUESTS_PER_DAY') ?? base.requestsPerDay,
  };
}

/**
 * `canteen-crowd` + `QWEATHER_KEY` → `CLOUD_SECRET_CANTEEN_CROWD__QWEATHER_KEY`. The double
 * underscore keeps plugins apart: secret names can't contain `__`, so the last `__` is always
 * the separator (with a single `_`, plugin `canteen` + `CROWD_KEY` would read `canteen-crowd`'s
 * `KEY`).
 */
export function secretEnvName(plugin: string, name: string): string {
  return `CLOUD_SECRET_${plugin.toUpperCase().replace(/-/g, '_')}__${name}`;
}
