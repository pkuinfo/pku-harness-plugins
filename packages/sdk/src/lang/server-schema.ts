import { z } from 'zod';

import type { AbilityDef } from './abilities';
import { fieldSchema, toolSchema, type FieldDef, type Manifest, type StepDoc, type ToolDoc } from './schema';

/**
 * The `server:` section of PLUGIN.md (pku-harness docs/CLOUD-FUNCTIONS.md §2–§5): server
 * functions, schedules, shared collections, operator secrets and the hosts server steps call.
 * The same steps and expressions as tools, run by the cloud server's interpreter with the
 * server's ability table (SERVER_ABILITIES) instead of the phone's.
 *
 * No import cycles: this file imports only `schema.ts`; `validateTool` (load.ts) is passed in.
 * `load.ts` builds the schema with `makeServerSchema(validateTool)` and plugs it into
 * `schema.ts`'s `serverSlot`, which `manifestSchema.server` reads lazily.
 */

/** No `__`: the operator's env name is `CLOUD_SECRET_<PLUGIN>__<NAME>`, split at the last `__`. */
export const secretNameSchema = z.string().regex(/^(?!.*__)[A-Z][A-Z0-9_]{0,40}$/, 'UPPER_SNAKE like QWEATHER_KEY (no double underscore)');
const hostSchema = z.string().regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'a host like example.com or *.example.com');
const nameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'letters, digits and _, starting with a letter');
const fieldNameSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/);
const durationSchema = z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d+)?\s*(ms|s|m|h|d)$/, 'like 30s, 5m, 1h or 1d')]);
const rateSchema = z.string().regex(/^\d{1,6}\/(m|h|d)$/, 'like 20/h, 5/m or 100/d');

export const accessSchema = z.enum(['user', 'peer', 'group', 'public', 'webhook']);
export type FunctionAccess = z.infer<typeof accessSchema>;

/** Abilities of the cloud server (§3.2): ids, effects and descriptions. The server supplies `run`. */
export const SERVER_ABILITY_DEFS: Record<string, Pick<AbilityDef, 'effect' | 'description'>> = {
  'kv.get': { effect: 'read', description: 'Per-user server KV value { key }, or null' },
  'kv.set': { effect: 'write', description: 'Set a per-user server KV value { key, value, ttl? }' },
  'kv.delete': { effect: 'write', description: 'Delete a per-user server KV value { key }' },
  'crypto.sha256': { effect: 'read', description: 'SHA-256 hex of text { text }' },
  'crypto.hmacSha256': { effect: 'read', description: 'HMAC-SHA256 hex { text, key } or { text, secret: NAME } (an operator secret by name; its value never enters scope)' },
  'crypto.randomId': { effect: 'read', description: 'Random base64url id { bytes?: 8–32, default 16 }' },
  'collection.add': { effect: 'write', description: 'Add a row to a declared collection { collection, value }' },
  'collection.get': { effect: 'read', description: 'One row by id { collection, id }' },
  'collection.query': { effect: 'read', description: 'Rows matching { collection, where?: r => bool, sort?, limit? ≤ 500 }' },
  'collection.update': { effect: 'write', description: 'Patch a row you wrote { collection, id, patch }' },
  'collection.remove': { effect: 'write', description: 'Remove a row you wrote { collection, id }' },
  'collection.count': { effect: 'read', description: 'Count rows { collection, where? }' },
  'push.send': { effect: 'write', description: 'Notify a user { to?, title, body, data? } (defaults to the caller)' },
};

/**
 * The table `validateTool` checks server steps against. Running them is the server's job: these
 * `run`s only refuse, so a phone that somehow gets one fails clearly.
 */
export const SERVER_ABILITIES: Record<string, AbilityDef> = Object.fromEntries(
  Object.entries(SERVER_ABILITY_DEFS).map(([id, d]) => [
    id,
    {
      ...d,
      run: async () => {
        throw new Error(`${id} runs only on the cloud server`);
      },
    },
  ]),
);

export type CollectionDoc = {
  scope: 'user' | 'plugin' | 'group';
  schema: Record<string, FieldDef>;
  ttl?: number | string;
  index?: string[];
  write?: { perUser?: string };
};

export type ServerFunctionDoc = Omit<ToolDoc, 'title' | 'description'> & {
  title?: string;
  description?: string;
  access: FunctionAccess;
  cache?: number | string;
};

export type ScheduleDoc = {
  title?: string;
  description?: string;
  cron?: string;
  every?: number | string;
  for: 'each-user' | 'once';
  args?: Record<string, FieldDef>;
  constants?: Record<string, unknown>;
  functions?: Record<string, string>;
  steps: StepDoc[];
};

export type ServerLimitsDoc = { steps?: number; requests?: number; wallMs?: number; ops?: number; resultBytes?: number };

export type ServerDoc = {
  network?: string[];
  secrets?: string[];
  collections?: Record<string, CollectionDoc>;
  functions?: Record<string, ServerFunctionDoc>;
  schedules?: Record<string, ScheduleDoc>;
  limits?: ServerLimitsDoc;
};

/** Five cron fields: digits, `*`, ranges, lists and steps (Beijing time). */
const CRON = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;
function cronOk(expr: string) {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => CRON.test(p));
}

function durationMs(d: number | string): number {
  if (typeof d === 'number') return d;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(d.trim());
  return m ? Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'ms'] : 0;
}

/** `secrets.NAME` references anywhere in a value (steps, templates). */
function secretRefs(v: unknown): string[] {
  return [...JSON.stringify(v ?? null).matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!);
}

/** Request steps that name a campus service (anywhere in a step list). */
function campusRequests(steps: unknown, where: string, out: string[]) {
  if (!Array.isArray(steps)) return;
  steps.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const step = s as Record<string, unknown>;
    const reqs = [step.request, (step.paginate as Record<string, unknown> | undefined)?.request];
    for (const r of reqs) if (r && typeof r === 'object' && 'campus' in r) out.push(`${where}[${i}]`);
    for (const k of ['steps', 'then', 'else', 'try', 'catch']) campusRequests(step[k], `${where}[${i}].${k}`, out);
  });
}

function build(validateTool: ValidateTool) {
  const functionSchema = toolSchema.extend({
    title: z.string().min(1).max(60).optional(),
    description: z.string().min(4).max(2000).optional(),
    access: accessSchema.default('user'),
    cache: durationSchema.optional(),
  });

  const collectionSchema = z
    .object({
      scope: z.enum(['user', 'plugin', 'group']),
      schema: z.record(fieldNameSchema, fieldSchema),
      ttl: durationSchema.optional(),
      index: z.array(fieldNameSchema).max(3).optional(),
      write: z.object({ perUser: rateSchema.optional() }).strict().optional(),
    })
    .strict()
    .superRefine((c, ctx) => {
      for (const f of c.index ?? []) if (!(f in c.schema)) ctx.addIssue({ code: 'custom', path: ['index'], message: `'${f}' is not a field of schema` });
    });

  const scheduleSchema = z
    .object({
      title: z.string().min(1).max(60).optional(),
      description: z.string().max(2000).optional(),
      cron: z.string().refine(cronOk, 'five cron fields like "30 7 * * 1-5" (Beijing time)').optional(),
      every: durationSchema.refine((d) => durationMs(d) >= 300_000, 'at least 5m').optional(),
      for: z.enum(['each-user', 'once']),
      args: z.record(fieldNameSchema, fieldSchema).optional(),
      constants: toolSchema.shape.constants,
      functions: toolSchema.shape.functions,
      steps: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    })
    .strict()
    .refine((s) => (s.cron === undefined) !== (s.every === undefined), 'a schedule needs exactly one of cron or every');

  const limitsSchema = z
    .object({
      steps: z.number().int().positive().optional(),
      requests: z.number().int().nonnegative().optional(),
      wallMs: z.number().int().positive().optional(),
      ops: z.number().int().positive().optional(),
      resultBytes: z.number().int().positive().optional(),
    })
    .strict();

  return z
    .object({
      network: z.array(hostSchema).optional(),
      secrets: z.array(secretNameSchema).optional(),
      collections: z.record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, 'lowercase first letter, letters, digits and _'), collectionSchema).optional(),
      functions: z.record(nameSchema, functionSchema).optional(),
      schedules: z.record(nameSchema, scheduleSchema).optional(),
      limits: limitsSchema.optional(),
    })
    .strict()
    .superRefine((server, ctx) => {
      for (const issue of validateServer(server as ServerDoc, validateTool)) ctx.addIssue({ code: 'custom', path: [], message: issue });
    });
}

/** `validateTool` from load.ts, injected to keep this module free of import cycles. */
export type ValidateTool = (manifest: Manifest, file: string, tool: ToolDoc, toolNames: Set<string>, opts?: { abilities?: Record<string, AbilityDef>; implicitAbilities?: boolean }) => string[];

/** Zod schema of `server:` (structure + every function and schedule body), built on first use. */
export function makeServerSchema(validateTool: ValidateTool) {
  let built: ReturnType<typeof build> | undefined;
  return z.lazy(() => (built ??= build(validateTool)));
}

/** What `validateTool` needs of a manifest, for server steps: only `server.network` is reachable. */
function serverManifest(server: ServerDoc): Manifest {
  return { network: server.network ?? [], campus: [], abilities: [] } as unknown as Manifest;
}

/**
 * Rules beyond structure: function and schedule bodies validated with the server ability table,
 * no campus requests, declared secrets only, and access/effect pairs (§3.1).
 */
export function validateServer(server: ServerDoc, validateTool: ValidateTool): string[] {
  const issues: string[] = [];
  const manifest = serverManifest(server);
  const fnNames = new Set(Object.keys(server.functions ?? {}));
  const declared = new Set(server.secrets ?? []);
  const opts = { abilities: SERVER_ABILITIES, implicitAbilities: true };

  const body = (where: string, tool: ToolDoc, names: Set<string>) => {
    const campus: string[] = [];
    campusRequests(tool.steps, 'steps', campus);
    for (const c of campus) issues.push(`${where} › ${c}.request.campus: server functions can't reach campus services (campus requests run only on the phone)`);
    // Campus requests are reported above; don't repeat them as "not listed in campus".
    issues.push(...validateTool(manifest, where, tool, names, opts).filter((i) => !/\.campus: '.*' is not listed/.test(i)));
    for (const name of new Set(secretRefs([tool.steps, tool.return, tool.constants, tool.functions])))
      if (!declared.has(name)) issues.push(`${where}: secrets.${name} is not declared in server.secrets`);
  };

  for (const [name, fn] of Object.entries(server.functions ?? {})) {
    const where = `server.functions.${name}`;
    if (fn.access === 'public' && fn.effect !== 'read') issues.push(`${where}: public functions must have effect read (got ${fn.effect})`);
    if (fn.access === 'webhook' && (fn.effect === 'money' || fn.effect === 'public')) issues.push(`${where}: webhook functions can't have effect ${fn.effect}`);
    if (fn.cache !== undefined && fn.effect !== 'read') issues.push(`${where}.cache: only read functions can be cached`);
    body(where, { title: fn.title ?? name, description: fn.description ?? name, ...fn } as ToolDoc, fnNames);
  }
  for (const [name, s] of Object.entries(server.schedules ?? {})) {
    const where = `server.schedules.${name}`;
    body(where, { title: s.title ?? name, description: s.description ?? name, effect: 'write', constants: s.constants, functions: s.functions, steps: s.steps }, fnNames);
  }
  return issues;
}
