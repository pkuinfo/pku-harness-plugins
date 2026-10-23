import { parse as parseYaml } from 'yaml';

import { ABILITIES, effectRank, type AbilityDef } from './abilities';
import { compile, ExprError, templateExprs } from './expr';
import { manifestSchema, serverSlot, sharedSchema, testSchema, toolSchema, viewSchema, type Manifest, type StepDoc, type TestDoc, type ToolDoc, type ViewDoc } from './schema';
import { makeServerSchema, validateServer as validateServerWith, type ServerDoc } from './server-schema';

/**
 * Load and validate a plugin document (docs/PLUGIN-LANGUAGE.md §3–§6): `PLUGIN.md` (YAML
 * frontmatter + Markdown instructions) plus the files it names. Everything is checked before
 * install — schemas, every expression and template, step shapes, declared hosts and abilities —
 * so a broken plugin fails with a precise message instead of at tool-run time.
 */

export type PluginDocument = {
  manifest: Manifest;
  /** Markdown body of PLUGIN.md: the agent instructions. */
  instructions: string;
  tools: Record<string, ToolDoc>;
  widgets: Record<string, ViewDoc>;
  screens: Record<string, ViewDoc>;
  /** Every loaded file's text by path (PLUGIN.md included), for hashing and showing the source. */
  files: Record<string, string>;
};

export class PluginDocError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.length === 1 ? issues[0] : `${issues.length} problems:\n- ${issues.join('\n- ')}`);
  }
}

const MAX_TOTAL_BYTES = 512_000;

/** Split `---\nyaml\n---\nmarkdown`. */
export function splitFrontmatter(text: string): { yaml: string; body: string } {
  const t = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) throw new PluginDocError(['PLUGIN.md must start with a --- frontmatter block']);
  const end = t.indexOf('\n---', 4);
  if (end < 0) throw new PluginDocError(['PLUGIN.md frontmatter is not closed with ---']);
  const after = t.indexOf('\n', end + 4);
  return { yaml: t.slice(4, end + 1), body: after < 0 ? '' : t.slice(after + 1).trim() };
}

function yaml(text: string, file: string): unknown {
  try {
    return parseYaml(text, { prettyErrors: true, maxAliasCount: 50 });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0]!;
    // The usual cause: an expression or ${…} containing ': ' (a ternary, an object) left unquoted.
    const hint = /mapping|implicit keys|Nested|Unexpected flow|bad indentation/i.test(msg) ? " — if that line holds an expression or ${…} with ': ' or starts with { or [, put it in quotes or use a | block" : '';
    throw new PluginDocError([`${file}: YAML: ${msg}${hint}`]);
  }
}

function zodIssues(file: string, err: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return err.issues.map((i) => `${file}${i.path.length ? ' › ' + i.path.map(String).join('.') : ''}: ${i.message}`);
}

// ---------------------------------------------------------------- step validation

const EXPR_FIELDS = new Set(['value', 'each', 'if', 'check', 'return', 'input', 'args']);
const STEP_KEYS: Record<string, string[]> = {
  request: ['let', 'request', 'as'],
  each: ['let', 'each', 'concurrency', 'request', 'as', 'steps', 'value', 'return'],
  paginate: ['let', 'paginate', 'as'],
  extract: ['let', 'extract', 'limit'],
  if: ['if', 'then', 'else'],
  check: ['check', 'error', 'code'],
  try: ['let', 'try', 'catch'],
  kv: ['let', 'kv', 'key', 'value', 'ttl'],
  cache: ['let', 'cache', 'steps', 'return'],
  call: ['let', 'call', 'input'],
  ability: ['let', 'ability', 'args'],
  value: ['let', 'value'],
  return: ['return'],
};
const KIND_ORDER = ['each', 'paginate', 'extract', 'request', 'if', 'check', 'try', 'kv', 'cache', 'call', 'ability', 'value', 'return'];
const REQUEST_KEYS = new Set(['campus', 'url', 'method', 'query', 'headers', 'json', 'form', 'body', 'contentType', 'followRedirects', 'timeout', 'maxSize']);

type Ctx = { file: string; manifest: Manifest; tool: ToolDoc; toolNames: Set<string>; issues: string[]; abilities: Record<string, AbilityDef>; implicitAbilities: boolean };

function checkExpr(c: Ctx, where: string, src: unknown) {
  if (typeof src !== 'string') {
    // Non-string values in expression fields are literal data (e.g. `value: [1, 2]` parsed by YAML).
    checkTemplates(c, where, src);
    return;
  }
  try {
    compile(src);
  } catch (e) {
    c.issues.push(`${c.file} › ${where}: ${(e as ExprError).message}`);
  }
}

function checkTemplates(c: Ctx, where: string, v: unknown) {
  if (typeof v === 'string') {
    try {
      for (const e of templateExprs(v)) compile(e);
    } catch (e) {
      c.issues.push(`${c.file} › ${where}: ${(e as Error).message}`);
    }
  } else if (Array.isArray(v)) v.forEach((x, i) => checkTemplates(c, `${where}[${i}]`, x));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) checkTemplates(c, `${where}.${k}`, x);
}

function checkRequest(c: Ctx, where: string, req: unknown) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    c.issues.push(`${c.file} › ${where}: request must be an object with a url`);
    return;
  }
  const r = req as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!REQUEST_KEYS.has(k)) c.issues.push(`${c.file} › ${where}.${k}: unknown request field (${[...REQUEST_KEYS].join(', ')})`);
  if (typeof r.url !== 'string') c.issues.push(`${c.file} › ${where}.url: required`);
  if (typeof r.campus === 'string' && !r.campus.includes('${') && !c.manifest.campus?.includes(r.campus)) c.issues.push(`${c.file} › ${where}.campus: '${r.campus}' is not listed in PLUGIN.md campus`);
  // Static host check only when the host itself isn't templated (templated hosts are checked at run time).
  if (r.campus === undefined && typeof r.url === 'string' && /^https?:\/\/[^/$]+(\/|$)/.test(r.url)) {
    try {
      const host = new URL(r.url.replace(/\$\{[^}]*\}/g, 'x')).hostname;
      const ok = (c.manifest.network ?? []).some((a) => (a.startsWith('*.') ? host.endsWith(a.slice(1)) : host === a));
      if (!ok && !r.url.startsWith('${')) c.issues.push(`${c.file} › ${where}.url: host ${host} is not listed in PLUGIN.md network`);
    } catch {
      /* templated host: checked at run time */
    }
  }
  checkTemplates(c, where, r);
}

function checkSteps(c: Ctx, where: string, steps: unknown) {
  if (!Array.isArray(steps)) {
    c.issues.push(`${c.file} › ${where}: must be a list of steps`);
    return;
  }
  steps.forEach((s, i) => checkStep(c, `${where}[${i}]`, s));
}

function checkStep(c: Ctx, where: string, step: unknown) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    c.issues.push(`${c.file} › ${where}: a step is an object like { let: x, value: ... }`);
    return;
  }
  const s = step as StepDoc;
  const kind = KIND_ORDER.find((k) => k in s);
  if (!kind) {
    c.issues.push(`${c.file} › ${where}: unknown step (keys: ${Object.keys(s).join(', ')})`);
    return;
  }
  for (const k of Object.keys(s)) if (!STEP_KEYS[kind]!.includes(k)) c.issues.push(`${c.file} › ${where}.${k}: not a field of a '${kind}' step`);
  if ('let' in s && (typeof s.let !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s.let))) c.issues.push(`${c.file} › ${where}.let: must be a name`);
  for (const f of Object.keys(s)) if (EXPR_FIELDS.has(f) && !(kind === 'call' && f === 'input' && typeof s[f] === 'object')) checkExpr(c, `${where}.${f}`, s[f]);
  if (kind === 'request' || (kind === 'each' && s.request)) checkRequest(c, `${where}.request`, s.request);
  if (s.as !== undefined && !['json', 'text', 'html', 'response'].includes(String(s.as))) c.issues.push(`${c.file} › ${where}.as: json, text, html or response`);
  if (kind === 'each' && !s.request && !s.steps && s.value === undefined) c.issues.push(`${c.file} › ${where}: each needs request, steps or value`);
  if (Array.isArray(s.steps)) checkSteps(c, `${where}.steps`, s.steps);
  if (kind === 'paginate') {
    const p = s.paginate as Record<string, unknown>;
    if (!p || typeof p !== 'object') c.issues.push(`${c.file} › ${where}.paginate: { request, items, next, max? }`);
    else {
      checkRequest(c, `${where}.paginate.request`, p.request);
      for (const f of ['items', 'next', 'start']) if (p[f] !== undefined) checkExpr(c, `${where}.paginate.${f}`, p[f]);
      if (p.items === undefined || p.next === undefined) c.issues.push(`${c.file} › ${where}.paginate: needs items and next`);
    }
  }
  if (kind === 'extract') {
    const x = s.extract as Record<string, unknown>;
    if (!x || typeof x.each !== 'string' || !x.fields || typeof x.fields !== 'object') c.issues.push(`${c.file} › ${where}.extract: { from, each: <css>, fields: { name: '<css> | text' } }`);
    else checkExpr(c, `${where}.extract.from`, x.from);
  }
  if (kind === 'if') {
    checkSteps(c, `${where}.then`, s.then ?? []);
    if (s.else !== undefined) checkSteps(c, `${where}.else`, s.else);
  }
  if (kind === 'try') {
    checkSteps(c, `${where}.try`, s.try);
    if (s.catch !== undefined) checkSteps(c, `${where}.catch`, s.catch);
  }
  if (kind === 'check') checkTemplates(c, `${where}.error`, s.error);
  if (kind === 'kv') {
    if (!['get', 'set', 'delete'].includes(String(s.kv))) c.issues.push(`${c.file} › ${where}.kv: get, set or delete`);
    checkTemplates(c, `${where}.key`, s.key);
  }
  if (kind === 'cache') {
    const k = s.cache as Record<string, unknown>;
    if (!k || typeof k.key !== 'string' || k.ttl === undefined) c.issues.push(`${c.file} › ${where}.cache: { key, ttl, staleOnError? }`);
  }
  if (kind === 'call' && !c.toolNames.has(String(s.call))) c.issues.push(`${c.file} › ${where}.call: no tool '${String(s.call)}' in this plugin`);
  if (kind === 'ability') {
    const id = String(s.ability);
    const ab = c.abilities[id];
    if (!ab) c.issues.push(`${c.file} › ${where}.ability: unknown ability '${id}' (${Object.keys(c.abilities).join(', ')})`);
    else {
      if (!c.implicitAbilities && !c.manifest.abilities?.includes(id.split('.')[0] as never)) c.issues.push(`${c.file} › ${where}.ability: add '${id.split('.')[0]}' to PLUGIN.md abilities`);
      if (effectRank(ab.effect) > effectRank(c.tool.effect)) c.issues.push(`${c.file} › ${where}.ability: ${id} needs effect '${ab.effect}' or stronger (the tool says '${c.tool.effect}')`);
    }
  }
}

/**
 * Validate one tool (already schema-checked). The cloud server validates `server.functions` with
 * its own ability table (`implicitAbilities`: its built-ins need no `abilities:` entry).
 */
export function validateTool(manifest: Manifest, file: string, tool: ToolDoc, toolNames: Set<string>, opts: { abilities?: Record<string, AbilityDef>; implicitAbilities?: boolean } = {}): string[] {
  const c: Ctx = { file, manifest, tool, toolNames, issues: [], abilities: opts.abilities ?? ABILITIES, implicitAbilities: opts.implicitAbilities ?? false };
  for (const [k, src] of Object.entries(tool.functions ?? {})) {
    try {
      if (compile(src).k !== 'fn') c.issues.push(`${file} › functions.${k}: must be an arrow function like (x) => x * 2`);
    } catch (e) {
      c.issues.push(`${file} › functions.${k}: ${(e as Error).message}`);
    }
  }
  checkSteps(c, 'steps', tool.steps ?? []);
  if (tool.return !== undefined) checkExpr(c, 'return', tool.return);
  if (!tool.steps?.length && tool.return === undefined) c.issues.push(`${file}: a tool needs steps or return`);
  return c.issues;
}

// ---------------------------------------------------------------- loading

/** `server.functions` as far as the phone needs it (the cloud server validates the rest). */
export function serverFunctions(m: Manifest): Record<string, { effect?: string; title?: string; description?: string }> {
  const fns = (m.server as { functions?: unknown } | undefined)?.functions;
  return fns && typeof fns === 'object' ? (fns as Record<string, { effect?: string }>) : {};
}

/** Fetch a file relative to PLUGIN.md (the host supplies it: HTTP for links, fs for the CLI). */
export type ReadFile = (path: string) => Promise<string>;

export async function loadDocument(read: ReadFile): Promise<PluginDocument> {
  const files: Record<string, string> = {};
  let total = 0;
  const get = async (path: string) => {
    const text = await read(path);
    total += text.length;
    if (total > MAX_TOTAL_BYTES) throw new PluginDocError([`the plugin's files are larger than ${MAX_TOTAL_BYTES / 1000} KB`]);
    files[path] = text;
    return text;
  };

  const { yaml: fm, body } = splitFrontmatter(await get('PLUGIN.md'));
  const parsed = manifestSchema.safeParse(yaml(fm, 'PLUGIN.md'));
  if (!parsed.success) throw new PluginDocError(zodIssues('PLUGIN.md', parsed.error));
  const manifest = parsed.data;
  const issues: string[] = [];

  // Shared constants/functions: merged into every tool (the tool's own definitions win).
  let shared: { constants?: Record<string, unknown>; functions?: Record<string, string> } = {};
  if (manifest.shared) {
    try {
      const sh = sharedSchema.safeParse(yaml(await get(manifest.shared), manifest.shared));
      if (sh.success) shared = sh.data;
      else issues.push(...zodIssues(manifest.shared, sh.error));
    } catch (e) {
      issues.push(e instanceof PluginDocError ? e.message : `${manifest.shared}: ${(e as Error).message}`);
    }
  }

  const tools: Record<string, ToolDoc> = {};
  const toolNames = new Set(Object.keys(manifest.tools ?? {}));
  for (const [name, ref] of Object.entries(manifest.tools ?? {})) {
    const file = typeof ref === 'string' ? ref : `PLUGIN.md › tools.${name}`;
    let raw: unknown = ref;
    if (typeof ref === 'string') {
      try {
        raw = yaml(await get(ref), ref);
      } catch (e) {
        issues.push(e instanceof PluginDocError ? e.message : `${ref}: ${(e as Error).message}`);
        continue;
      }
    }
    const t = toolSchema.safeParse(raw);
    if (!t.success) {
      issues.push(...zodIssues(file, t.error));
      continue;
    }
    const tool: ToolDoc = {
      ...t.data,
      constants: shared.constants || t.data.constants ? { ...shared.constants, ...t.data.constants } : undefined,
      functions: shared.functions || t.data.functions ? { ...shared.functions, ...t.data.functions } : undefined,
    };
    tools[name] = tool;
    issues.push(...validateTool(manifest, file, tool, toolNames));
  }

  const views = async (kind: 'widgets' | 'screens') => {
    const out: Record<string, ViewDoc> = {};
    for (const [name, path] of Object.entries(manifest[kind] ?? {})) {
      try {
        const raw = JSON.parse(await get(path));
        const v = viewSchema.safeParse(raw);
        if (!v.success) issues.push(...zodIssues(path, v.error));
        else {
          for (const [ptr, b] of Object.entries(v.data.bindings ?? {})) {
            if (b.fn) {
              const fn = serverFunctions(manifest)[b.fn];
              if (!fn) issues.push(`${path} › bindings.${ptr}: no server function '${b.fn}' (server.functions)`);
              else if (fn.effect !== undefined && fn.effect !== 'read') issues.push(`${path} › bindings.${ptr}: server function '${b.fn}' is not read-only`);
              continue;
            }
            const tool = b.tool!;
            const short = tool.includes('.') ? tool.split('.').slice(1).join('.') : tool;
            const own = !tool.includes('.') || tool.startsWith(`${manifest.id}.`);
            if (own && !tools[short]) issues.push(`${path} › bindings.${ptr}: no tool '${tool}'`);
            else if (own && tools[short]!.effect !== 'read') issues.push(`${path} › bindings.${ptr}: '${tool}' is not a read tool`);
          }
          out[name] = v.data;
        }
      } catch (e) {
        issues.push(e instanceof PluginDocError ? e.message : `${path}: ${(e as Error).message}`);
      }
    }
    return out;
  };
  const widgets = await views('widgets');
  const screens = await views('screens');

  for (const [name, ds] of Object.entries(manifest.dataSources ?? {})) {
    if (!tools[ds.tool]) issues.push(`PLUGIN.md › dataSources.${name}: no tool '${ds.tool}'`);
    else if (tools[ds.tool]!.effect !== 'read') issues.push(`PLUGIN.md › dataSources.${name}: '${ds.tool}' is not a read tool`);
  }
  for (const s of manifest.settings ?? []) if (!screens[s.screen]) issues.push(`PLUGIN.md › settings: no screen '${s.screen}'`);
  if (manifest.remote && manifest.tools && Object.keys(manifest.tools).length) issues.push('PLUGIN.md: a remote (MCP) plugin has no tools of its own');
  // Server functions send data to a server: the user must be told what, in the consent sheet.
  const disclosure = (manifest.cloud as { disclosure?: { zh?: unknown[] } } | undefined)?.disclosure;
  if (manifest.server && !disclosure?.zh?.length) issues.push("PLUGIN.md: a plugin with server: must say what leaves the device — cloud: { disclosure: { zh: ['…'], en: ['…'] } }");

  if (issues.length) throw new PluginDocError(issues);
  return { manifest, instructions: body, tools, widgets, screens, files };
}

/** Parse a recorded test file (CLI only). */
export function parseTest(text: string, file: string): TestDoc {
  const t = testSchema.safeParse(yaml(text, file));
  if (!t.success) throw new PluginDocError(zodIssues(file, t.error));
  return t.data;
}

/** What a plugin may reach: an update that widens this needs the user's consent again (§10). */
export function declarations(doc: Pick<PluginDocument, 'manifest' | 'tools'>) {
  const sorted = (xs?: string[]) => [...new Set(xs ?? [])].sort();
  return {
    campus: sorted(doc.manifest.campus),
    network: sorted(doc.manifest.network),
    abilities: sorted(doc.manifest.abilities),
    effects: sorted(Object.values(doc.tools).map((t) => t.effect)),
    cloud: !!doc.manifest.cloud,
    remote: doc.manifest.remote?.mcp ?? null,
  };
}

/** True when `next` asks for anything `prev` didn't. */
export function widens(prev: ReturnType<typeof declarations>, next: ReturnType<typeof declarations>): boolean {
  const more = (a: string[], b: string[]) => b.some((x) => !a.includes(x));
  return more(prev.campus, next.campus) || more(prev.network, next.network) || more(prev.abilities, next.abilities) || more(prev.effects, next.effects) || (!prev.cloud && next.cloud) || prev.remote !== next.remote;
}

/** Stable text for hashing a document's files (the host hashes it with services.crypto.sha256). */
export function fingerprintText(files: Record<string, string>): string {
  return Object.keys(files)
    .sort()
    .map((p) => `${p}\n${files[p]!.length}\n${files[p]}`)
    .join('\n');
}

export function effectOfAbility(id: string) {
  return ABILITIES[id]?.effect;
}

/** The `server:` schema, built with this module's `validateTool` and plugged into manifestSchema. */
export const serverSchema = makeServerSchema(validateTool);
serverSlot.schema = serverSchema;

/** Server-section rules beyond structure (server-schema.ts `validateServer`, bound to validateTool). */
export const validateServer = (server: ServerDoc) => validateServerWith(server, validateTool);
