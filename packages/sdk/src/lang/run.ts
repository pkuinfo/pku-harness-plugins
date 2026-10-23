import { parse as parseHtml } from 'node-html-parser';

import type { CampusRequest, CampusResponse } from '../campus';
import type { PluginCloud } from '../cloud';
import type { HostServices, KV, ToolEffect } from '../plugin';
import { ABILITIES, effectRank, type AbilityDef } from './abilities';
import { callFn, compile, evaluate, ExprError, getProp, isFn, lambda, Scope, template, templateDeep, type EvalContext } from './expr';
import { durationMs, type Manifest, type StepDoc, type ToolDoc } from './schema';
import { isNode, squash, STDLIB, wrapNode } from './stdlib';

/**
 * Runs a tool written in the plugin language (docs/PLUGIN-LANGUAGE.md §6). The runner is the only
 * thing that does I/O: requests go to the plugin's declared campus services (through the host's
 * signed-in sessions) or declared public hosts, storage goes to the plugin's own KV, and abilities
 * to the host. Every limit in §6.5 is enforced here.
 */

export const LIMITS = {
  steps: 400,
  requests: 60,
  inFlight: 4,
  wallMs: 60_000,
  /** Default per response; a request may raise it with `maxSize` up to `responseBytesMax`. */
  responseBytes: 2_000_000,
  responseBytesMax: 8_000_000,
  resultBytes: 1_000_000,
  ops: 300_000,
  kvValueBytes: 256_000,
  eachItems: 50,
  pages: 30,
  callDepth: 3,
};

/** Public HTTP for plugins: the host supplies it (fetch with a timeout); the runner checks hosts. */
export type PublicFetch = (req: { url: string; method: string; headers: Record<string, string>; body?: string; timeoutMs: number; followRedirects: boolean }) => Promise<{ status: number; url: string; headers: Record<string, string>; body: string }>;

export interface RunEnv {
  manifest: Pick<Manifest, 'id' | 'campus' | 'network' | 'abilities'>;
  tools: Record<string, ToolDoc>;
  /** Host services (phone). Campus requests and the phone abilities use them. */
  services: HostServices;
  kv: KV;
  fetch: PublicFetch;
  /** Clock (ms epoch); fixed in tests. */
  now?: () => number;
  signal?: AbortSignal;
  /**
   * The host's instruction set for `ability:` steps (default: the phone's ABILITIES). The cloud
   * server passes its own (collection, push, channel…; docs/CLOUD-FUNCTIONS.md §3.2).
   */
  abilities?: Record<string, AbilityDef>;
  /** Abilities usable without listing them in `abilities:` (the server's built-ins). */
  implicitAbilities?: boolean;
  /** Operator secrets: visible as `secrets.NAME` only inside request templates, never elsewhere. */
  secrets?: Record<string, string>;
  /** Extra read-only names in scope (e.g. `caller`, `group` on the server). */
  scope?: Record<string, unknown>;
  /** False on hosts without campus sessions (the server): campus requests fail clearly. */
  campus?: boolean;
  /** This plugin's cloud client, for the `cloud.call` ability. */
  cloud?: PluginCloud;
  /** Limit overrides (only lower than LIMITS). */
  limits?: Partial<typeof LIMITS>;
}

export class ToolFailure extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

class Return {
  constructor(readonly value: unknown) {}
}

type Run = {
  env: RunEnv;
  lim: typeof LIMITS;
  ctx: EvalContext & { now: number };
  steps: number;
  requests: number;
  inFlight: number;
  deadline: number;
  depth: number;
  effect: ToolEffect;
};

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36 PKUHarness';

function hostAllowed(host: string, allowed: string[] = []) {
  const h = host.toLowerCase();
  return allowed.some((a) => (a.startsWith('*.') ? h.endsWith(a.slice(1).toLowerCase()) || h === a.slice(2).toLowerCase() : h === a.toLowerCase()));
}

function guard(run: Run) {
  if (run.env.signal?.aborted) throw new ToolFailure('cancelled');
  if (Date.now() > run.deadline) throw new ToolFailure(`the tool took longer than ${run.lim.wallMs / 1000} s`);
}

function encodeForm(form: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(form)) {
    for (const x of Array.isArray(v) ? v : [v]) if (x != null) out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(x))}`);
  }
  return out.join('&');
}

function withQuery(url: string, query?: Record<string, unknown>) {
  if (!query) return url;
  const qs = encodeForm(query);
  return qs ? url + (url.includes('?') ? '&' : '?') + qs : url;
}

type RequestDoc = {
  campus?: string;
  url: string;
  method?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  json?: unknown;
  form?: Record<string, unknown>;
  body?: string;
  contentType?: string;
  followRedirects?: boolean;
  timeout?: string | number;
  /** Larger pages (e.g. WeChat articles, ~4 MB): bytes, at most LIMITS.responseBytesMax. */
  maxSize?: number;
};

/** One request; returns the response shaped by `as`. */
async function request(run: Run, raw: unknown, as: unknown, scope: Scope): Promise<unknown> {
  guard(run);
  if (++run.requests > run.lim.requests) throw new ToolFailure(`more than ${run.lim.requests} requests in one run`);
  while (run.inFlight >= run.lim.inFlight) await new Promise((r) => setTimeout(r, 5));
  let tscope = scope;
  if (run.env.secrets) {
    tscope = scope.child();
    tscope.set('secrets', { ...run.env.secrets });
  }
  const req = templateDeep(raw, tscope, run.ctx) as RequestDoc;
  if (!req || typeof req.url !== 'string') throw new ToolFailure('request needs a url');
  const method = (req.method ?? (req.json !== undefined || req.form || req.body !== undefined ? 'POST' : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'POST') throw new ToolFailure(`method ${method} is not supported (GET or POST)`);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) if (v != null) headers[k.toLowerCase()] = String(v);
  let body: string | undefined;
  let contentType = req.contentType;
  if (req.json !== undefined) {
    body = JSON.stringify(req.json);
    contentType ??= 'application/json';
  } else if (req.form) {
    body = encodeForm(req.form);
    contentType ??= 'application/x-www-form-urlencoded';
  } else if (req.body !== undefined) body = String(req.body);
  const url = withQuery(req.url, req.query);
  const timeoutMs = Math.min(run.lim.wallMs, req.timeout == null ? 20_000 : durationMs(req.timeout));
  const followRedirects = req.followRedirects ?? true;

  let res: CampusResponse;
  run.inFlight++;
  try {
    if (req.campus) {
      if (run.env.campus === false) throw new ToolFailure(`campus services are only available on the phone (requested '${req.campus}')`);
      if (!run.env.manifest.campus?.includes(req.campus)) throw new ToolFailure(`campus service '${req.campus}' is not declared in PLUGIN.md (campus: [...])`);
      const creq: CampusRequest = { url, method: method as 'GET' | 'POST', headers, body, contentType, followRedirects, timeoutMs };
      res = await run.env.services.campus.request(req.campus, creq);
    } else {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        throw new ToolFailure(`not an absolute URL: ${url} (add campus: <service> for campus paths)`);
      }
      if (u.protocol !== 'https:') throw new ToolFailure(`only https:// is allowed (${u.host})`);
      if (!hostAllowed(u.hostname, run.env.manifest.network)) throw new ToolFailure(`host ${u.hostname} is not declared in PLUGIN.md (network: [...])`);
      if (contentType) headers['content-type'] = contentType;
      headers['user-agent'] ??= UA;
      res = await run.env.fetch({ url, method, headers, body, timeoutMs, followRedirects });
      const final = (() => {
        try {
          return new URL(res.url || url).hostname;
        } catch {
          return u.hostname;
        }
      })();
      if (!hostAllowed(final, run.env.manifest.network)) throw new ToolFailure(`the request was redirected to ${final}, which is not declared in network`);
    }
  } finally {
    run.inFlight--;
  }
  const maxSize = Math.min(run.lim.responseBytesMax, Math.max(run.lim.responseBytes, Number(req.maxSize) || 0));
  if (res.body.length > maxSize) throw new ToolFailure(`response larger than ${maxSize / 1e6} MB (raise request.maxSize, at most ${run.lim.responseBytesMax / 1e6} MB)`);
  const mode = as == null ? (/json/i.test(res.headers['content-type'] ?? '') ? 'json' : 'text') : String(as);
  const shown = (() => {
    try {
      return new URL(res.url || url).host;
    } catch {
      return req.campus ?? url;
    }
  })();
  if (mode !== 'response' && (res.status < 200 || res.status >= 400)) throw new ToolFailure(`HTTP ${res.status} from ${shown}`);
  switch (mode) {
    case 'response':
      return { status: res.status, url: res.url, headers: res.headers, text: res.body };
    case 'text':
      return res.body;
    case 'html':
      return wrapNode(parseHtml(res.body), res.url || url);
    case 'json':
      try {
        return JSON.parse(res.body);
      } catch {
        throw new ToolFailure(`${shown} did not return JSON (HTTP ${res.status}: ${squash(res.body).slice(0, 80)})`);
      }
    default:
      throw new ToolFailure(`unknown 'as: ${mode}' (json, text, html or response)`);
  }
}

// ------------------------------------------------------------ extraction pipes (§6.3)

function pipe(run: Run, item: unknown, spec: string): unknown {
  const [sel = '', ...ops] = spec.split(/\s+\|\s+|^\|\s*|\s+\|$/).map((s) => s.trim());
  const call = (name: string, ...args: unknown[]) => run.ctx.call(STDLIB[name]!, args);
  let all = false;
  if (ops[0] === 'all') {
    all = true;
    ops.shift();
  }
  const apply = (v: unknown): unknown => {
    let cur = v;
    for (const op of ops) {
      if (cur == null) return null;
      const [name, ...rest] = op.split(/\s+/);
      const arg = rest.join(' ');
      switch (name) {
        case 'text':
          cur = isNode(cur) ? call('text', cur) : squash(String(cur));
          break;
        case 'html':
          cur = isNode(cur) ? getProp(cur, 'html') : cur;
          break;
        case 'attr':
          cur = call('attr', cur, arg);
          break;
        case 'data':
          cur = call('data', cur, arg);
          break;
        case 'url':
          cur = call('url', arg || getProp(item, 'url') || '', isNode(cur) ? call('text', cur) : cur);
          break;
        case 'num':
          cur = call('num', isNode(cur) ? call('text', cur) : cur);
          break;
        case 'date':
          cur = call('date', isNode(cur) ? call('text', cur) : cur);
          break;
        case 'match': {
          const m = /^(.*?)(?:\s+(\w+))?$/.exec(arg)!;
          cur = call('match', isNode(cur) ? call('text', cur) : cur, m[1], m[2] ?? 1);
          break;
        }
        case 'trim':
          cur = String(isNode(cur) ? call('text', cur) : cur).trim();
          break;
        case 'squash':
          cur = squash(String(isNode(cur) ? call('text', cur) : cur));
          break;
        default:
          throw new ToolFailure(`unknown extract pipe '${name}'`);
      }
    }
    return isNode(cur) ? call('text', cur) : cur;
  };
  if (!sel || sel === '.') return apply(item);
  if (all) return (call('select', item, sel) as unknown[]).map(apply);
  const el = call('first', item, sel);
  return el == null ? null : apply(el);
}

// ------------------------------------------------------------ steps

async function kvGet(run: Run, key: string) {
  const v = await run.env.kv.get<{ v: unknown; exp?: number }>(`doc:${key}`);
  if (!v) return null;
  if (v.exp && v.exp < run.ctx.now) return null;
  return v.v;
}

async function kvSet(run: Run, key: string, value: unknown, ttl?: unknown) {
  const json = JSON.stringify(value ?? null);
  if (json.length > run.lim.kvValueBytes) throw new ToolFailure(`kv value for '${key}' is larger than ${run.lim.kvValueBytes / 1000} KB`);
  await run.env.kv.set(`doc:${key}`, { v: JSON.parse(json), exp: ttl == null ? undefined : run.ctx.now + durationMs(ttl as string) });
}

function expr(run: Run, src: unknown, scope: Scope): unknown {
  if (typeof src !== 'string') return templateDeep(src, scope, run.ctx);
  return evaluate(compile(src), scope, run.ctx);
}

async function runSteps(run: Run, steps: StepDoc[], scope: Scope): Promise<unknown> {
  let last: unknown;
  for (const step of steps) {
    guard(run);
    if (++run.steps > run.lim.steps) throw new ToolFailure(`more than ${run.lim.steps} steps in one run`);
    const value = await runStep(run, step, scope);
    if (typeof step.let === 'string') {
      scope.set(step.let, value);
      last = value;
    }
  }
  return last;
}

async function eachOf<T>(items: unknown[], concurrency: number, fn: (x: unknown, i: number) => Promise<T>): Promise<T[]> {
  const out = new Array<T>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function runStep(run: Run, step: StepDoc, scope: Scope): Promise<unknown> {
  if ('return' in step && Object.keys(step).length === 1) throw new Return(expr(run, step.return, scope));

  if ('each' in step) {
    const items = expr(run, step.each, scope);
    if (!Array.isArray(items)) throw new ToolFailure(`each: expected a list, got ${items === null ? 'null' : typeof items}`);
    if (items.length > run.lim.eachItems) throw new ToolFailure(`each: ${items.length} items (max ${run.lim.eachItems}); slice the list first`);
    const conc = Math.max(1, Math.min(run.lim.inFlight, Number(step.concurrency ?? 1)));
    return eachOf(items, conc, async (item, index) => {
      const s = scope.child();
      s.set('item', item);
      s.set('index', index);
      if (step.request) return request(run, step.request, step.as, s);
      if (Array.isArray(step.steps)) {
        try {
          const last = await runSteps(run, step.steps as StepDoc[], s);
          return 'return' in step ? expr(run, step.return, s) : last;
        } catch (e) {
          if (e instanceof Return) return e.value;
          throw e;
        }
      }
      return expr(run, step.value, s);
    });
  }

  if ('request' in step) return request(run, step.request, step.as, scope);

  if ('paginate' in step) {
    const p = step.paginate as { request: unknown; items: string; next: string; start?: string; max?: number; as?: string };
    const max = Math.max(1, Math.min(run.lim.pages, Number(p.max ?? 10)));
    const s = scope.child();
    s.set('cursor', p.start == null ? null : expr(run, p.start, scope));
    const all: unknown[] = [];
    for (let i = 0; i < max; i++) {
      s.set('pageIndex', i);
      const page = await request(run, p.request, p.as ?? step.as, s);
      s.set('page', page);
      const items = expr(run, p.items, s);
      if (Array.isArray(items)) all.push(...items);
      const next = expr(run, p.next, s);
      if (next == null || next === false || (Array.isArray(items) && items.length === 0)) break;
      s.set('cursor', next);
    }
    return all;
  }

  if ('extract' in step) {
    const x = step.extract as { from: string; each: string; fields: Record<string, string>; limit?: number };
    const from = expr(run, x.from, scope);
    const doc = typeof from === 'string' ? wrapNode(parseHtml(from)) : from;
    const items = run.ctx.call(STDLIB.select!, [doc, x.each]) as unknown[];
    const limit = Number(x.limit ?? step.limit ?? 200);
    return items.slice(0, limit).map((it) => Object.fromEntries(Object.entries(x.fields).map(([k, spec]) => [k, pipe(run, it, spec)])));
  }

  if ('if' in step) {
    const branch = expr(run, step.if, scope) ? step.then : step.else;
    return Array.isArray(branch) ? runSteps(run, branch as StepDoc[], scope) : undefined;
  }

  if ('check' in step) {
    if (!expr(run, step.check, scope)) throw new ToolFailure(String(template(String(step.error ?? 'check failed'), scope, run.ctx)), step.code as string | undefined);
    return true;
  }

  if ('try' in step) {
    try {
      return await runSteps(run, step.try as StepDoc[], scope);
    } catch (e) {
      if (e instanceof Return) throw e;
      const s = scope;
      s.set('error', { message: (e as Error).message, code: (e as ToolFailure).code ?? null });
      return Array.isArray(step.catch) ? runSteps(run, step.catch as StepDoc[], s) : undefined;
    }
  }

  if ('kv' in step) {
    const key = String(template(String(step.key), scope, run.ctx));
    if (step.kv === 'get') return kvGet(run, key);
    if (step.kv === 'set') {
      const v = expr(run, step.value, scope);
      await kvSet(run, key, v, step.ttl);
      return v;
    }
    if (step.kv === 'delete') return run.env.kv.delete(`doc:${key}`).then(() => null);
    throw new ToolFailure(`kv: ${String(step.kv)} (get, set or delete)`);
  }

  if ('cache' in step) {
    const c = step.cache as { key: string; ttl: string; staleOnError?: boolean; refresh?: unknown };
    const key = `cache:${String(template(c.key, scope, run.ctx))}`;
    const hit = await run.env.kv.get<{ v: unknown; at: number }>(`doc:${key}`);
    const ttl = durationMs(c.ttl);
    const refresh = c.refresh !== undefined && !!expr(run, c.refresh, scope);
    if (hit && !refresh && run.ctx.now - hit.at < ttl) return hit.v;
    const compute = async () => {
      const s = scope.child();
      try {
        const last = await runSteps(run, (step.steps as StepDoc[]) ?? [], s);
        return 'return' in step ? expr(run, step.return, s) : last;
      } catch (e) {
        if (e instanceof Return) return e.value;
        throw e;
      }
    };
    try {
      const v = await compute();
      await run.env.kv.set(`doc:${key}`, { v: JSON.parse(JSON.stringify(v ?? null)), at: run.ctx.now });
      return v;
    } catch (e) {
      if (c.staleOnError && hit) return hit.v;
      throw e;
    }
  }

  if ('call' in step) {
    const name = String(step.call);
    const tool = run.env.tools[name];
    if (!tool) throw new ToolFailure(`call: no tool '${name}' in this plugin`);
    if (effectRank(tool.effect) > effectRank(run.effect)) throw new ToolFailure(`call: '${name}' (${tool.effect}) needs a stronger effect than this tool (${run.effect})`);
    if (run.depth >= run.lim.callDepth) throw new ToolFailure('call: nested too deeply');
    const input = expr(run, step.input ?? '{}', scope) as Record<string, unknown>;
    return execTool({ ...run, depth: run.depth + 1, effect: tool.effect }, tool, input);
  }

  if ('ability' in step) {
    const id = String(step.ability);
    const ab = (run.env.abilities ?? ABILITIES)[id];
    if (!ab) throw new ToolFailure(`unknown ability '${id}'`);
    const group = id.split('.')[0]!;
    if (!run.env.implicitAbilities && !run.env.manifest.abilities?.includes(group as never)) throw new ToolFailure(`ability '${group}' is not declared in PLUGIN.md (abilities: [...])`);
    if (effectRank(ab.effect) > effectRank(run.effect)) throw new ToolFailure(`ability ${id} needs effect '${ab.effect}' or stronger`);
    const args = step.args === undefined ? {} : expr(run, step.args, scope);
    return ab.run(args as Record<string, unknown>, {
      services: run.env.services,
      kv: run.env.kv,
      request: (r) => request(run, r, 'json', scope),
      call: (fn, fnArgs) => run.ctx.call(fn, fnArgs),
      cloud: run.env.cloud,
    });
  }

  if ('value' in step) return expr(run, step.value, scope);

  throw new ToolFailure(`unknown step with keys ${Object.keys(step).join(', ')}`);
}

/** JSON-safe result: nodes become text, functions disappear. */
function plain(v: unknown, depth = 0): unknown {
  if (depth > 50) return null;
  if (isNode(v)) return getProp(v, 'text');
  if (isFn(v)) return undefined;
  if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x, depth + 1)]).filter(([, x]) => x !== undefined));
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}

async function execTool(run: Run, tool: ToolDoc, input: Record<string, unknown>): Promise<unknown> {
  const root = new Scope();
  root.set('input', input);
  root.set('now', run.ctx.now);
  for (const [k, v] of Object.entries(run.env.scope ?? {})) root.set(k, v);
  for (const [k, v] of Object.entries(tool.constants ?? {})) root.set(k, v);
  for (const [k, src] of Object.entries(tool.functions ?? {})) {
    const node = compile(src);
    if (node.k !== 'fn') throw new ToolFailure(`function ${k} must be an arrow function like (x) => x + 1`);
    root.set(k, lambda(node.params, node.body, root, src));
  }
  const scope = root.child();
  try {
    const last = await runSteps(run, (tool.steps ?? []) as StepDoc[], scope);
    return tool.return === undefined ? last : expr(run, tool.return, scope);
  } catch (e) {
    if (e instanceof Return) return e.value;
    throw e;
  }
}

/** Run one tool of a plugin document. Throws ToolFailure / ExprError with a readable message. */
export async function runTool(env: RunEnv, name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = env.tools[name];
  if (!tool) throw new ToolFailure(`no tool '${name}'`);
  const now = env.now?.() ?? Date.now();
  const lim = { ...LIMITS };
  for (const [k, v] of Object.entries(env.limits ?? {})) if (typeof v === 'number') lim[k as keyof typeof LIMITS] = Math.min(lim[k as keyof typeof LIMITS], v);
  const ctx: EvalContext & { now: number } = {
    budget: { ops: lim.ops },
    stdlib: STDLIB,
    now,
    call: (fn, args) => callFn(fn, args, ctx),
  };
  const run: Run = { env, lim, ctx, steps: 0, requests: 0, inFlight: 0, deadline: Date.now() + lim.wallMs, depth: 0, effect: tool.effect };
  try {
    const out = plain(await execTool(run, tool, input));
    const size = JSON.stringify(out ?? null).length;
    if (size > run.lim.resultBytes) throw new ToolFailure(`result larger than ${run.lim.resultBytes / 1e6} MB; return fewer items`);
    return out;
  } catch (e) {
    if (e instanceof ExprError) throw new ToolFailure(`${name}: ${e.message}`);
    throw e;
  }
}
