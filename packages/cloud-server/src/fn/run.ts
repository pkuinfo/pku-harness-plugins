/**
 * Running one server function (docs/CLOUD-FUNCTIONS.md §3): the SDK's interpreter (`runTool`)
 * with the server's RunEnv — `server.network` as the only reachable hosts, server KV, server
 * abilities, operator secrets (request templates and `crypto.hmacSha256 { secret }` only), no
 * campus, and the §3.3 limits. Results and error messages are scrubbed of secret values before
 * they leave the server.
 *
 * Runs are in-process for now. TODO(stage 2b): a Bun Worker pool (§10) so a CPU-heavy run can't
 * stall the event loop; the interpreter's op budget and wall-time guard bound runs meanwhile.
 */
import { inputZod } from '@pku-harness/sdk/lang/compile';
import { runTool, ToolFailure, type RunEnv } from '@pku-harness/sdk/lang/run';
import type { ToolDoc } from '@pku-harness/sdk/lang/schema';
import type { ServerFunctionDoc } from '@pku-harness/sdk/lang/server-schema';

import { type FunctionsConfig, secretEnvName } from '../config';
import type { Storage } from '../db/storage';
import { HttpError } from '../errors';
import type { RateLimiter } from '../limits';
import type { CompiledDoc } from './docs';
import { noKV, serverAbilities, serverFetch, serverKV, serverServices } from './host';

const DAY_S = 86_400;

export interface RunDeps {
  cfg: FunctionsConfig;
  storage: Storage;
  limiter: RateLimiter;
  fetch: typeof fetch;
  now: () => number;
  storeQuota: { maxKeys: number; maxBytes: number; maxValueBytes: number };
}

export interface Caller {
  deviceId: string;
  /** Per-plugin pseudonym: the only identity plugin code sees. */
  pseudonym: string;
}

/** Secrets the document declares that the operator set, by name. */
function secretsFor(cfg: FunctionsConfig, doc: CompiledDoc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of doc.server.secrets ?? []) {
    const v = cfg.secrets[secretEnvName(doc.plugin, name)];
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** Replace every secret value (≥ 4 chars) in text. */
function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('[secret]');
  return out;
}

function scrubValue(v: unknown, secrets: string[]): unknown {
  if (!secrets.some((s) => s.length >= 4)) return v;
  const json = JSON.stringify(v ?? null);
  const clean = scrub(json, secrets.map((s) => JSON.stringify(s).slice(1, -1)));
  return clean === json ? v : JSON.parse(clean);
}

/** Validate input against the function's declared fields (defaults applied). */
export function parseInput(fn: ServerFunctionDoc, input: Record<string, unknown>): Record<string, unknown> {
  const r = inputZod(fn.input).safeParse(input);
  if (!r.success) {
    const where = r.error.issues
      .slice(0, 3)
      .map((i) => i.path.join('.') || '(root)')
      .join(', ');
    throw new HttpError('bad_request', `invalid input: ${where}`);
  }
  return r.data as Record<string, unknown>;
}

/** GET query → input, coercing numbers and booleans by the declared field types. */
export function inputFromQuery(fn: ServerFunctionDoc, query: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) {
    const t = fn.input?.[k]?.type;
    const isNum = t === 'number' || t === 'integer' || (fn.input?.[k]?.enum?.every((x) => typeof x === 'number') ?? false);
    out[k] = isNum && v !== '' && Number.isFinite(Number(v)) ? Number(v) : t === 'boolean' && (v === 'true' || v === 'false') ? v === 'true' : v;
  }
  return out;
}

export async function runFunction(d: RunDeps, doc: CompiledDoc, name: string, input: Record<string, unknown>, caller?: Caller): Promise<unknown> {
  const fn = doc.functions[name];
  if (!fn) throw new HttpError('not_found', 'no such function');
  const secrets = secretsFor(d.cfg, doc);
  const values = Object.values(secrets);

  // A function that templates a secret the operator never set fails up front, clearly.
  for (const m of JSON.stringify([fn.steps, fn.return, fn.constants]).matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g))
    if (!(m[1]! in secrets)) throw new HttpError('failed', `secret ${m[1]} is not set on this server`);

  const lim = { ...d.cfg.run };
  for (const [k, v] of Object.entries(doc.server.limits ?? {})) if (typeof v === 'number' && k in lim) lim[k as keyof typeof lim] = Math.min(lim[k as keyof typeof lim], v);

  const network = doc.server.network ?? [];
  const reqRate = { limit: d.cfg.requestsPerDay, windowS: DAY_S };
  const env: RunEnv = {
    manifest: { id: doc.plugin, network, campus: [], abilities: [] },
    tools: doc.functions as unknown as Record<string, ToolDoc>,
    services: serverServices,
    kv: caller ? serverKV(d.storage, caller.deviceId, doc.plugin, d.storeQuota, d.now) : noKV,
    fetch: serverFetch({
      fetch: d.fetch,
      network,
      maxBytes: lim.responseBytes,
      onRequest: () => {
        if (!d.limiter.take(`fnreq:${doc.plugin}`, reqRate).ok) throw new ToolFailure('this plugin reached its daily outbound request quota', 'quota');
      },
    }),
    now: d.now,
    signal: AbortSignal.timeout(lim.wallMs + 1000),
    abilities: serverAbilities({ secrets, now: d.now }),
    implicitAbilities: true,
    secrets,
    scope: { caller: caller ? { id: caller.pseudonym } : null },
    campus: false,
    limits: lim,
  };

  try {
    return scrubValue(await runTool(env, name, input), values);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const message = scrub(e instanceof Error ? e.message : 'the function failed', values);
    if (e instanceof ToolFailure && e.code === 'quota') throw new HttpError('rate_limited', message, 3600);
    if (e instanceof ToolFailure && e.code === 'unsupported') throw new HttpError('unsupported', message);
    throw new HttpError('failed', message);
  }
}
