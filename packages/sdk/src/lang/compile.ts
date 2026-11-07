import { createElement, useEffect, useMemo, useState, type ComponentType } from 'react';
import { z } from 'zod';

import type { Capability, PluginDef, PluginTranslation, ToolDef, ToolEffect } from '../plugin';
import type { PluginScreenProps, PluginWidgetProps } from '../ui';
import { serverFunctions, type PluginDocument } from './load';
import { runTool, ToolFailure, type PublicFetch } from './run';
import { durationMs, type FieldDef, type ToolDoc, type ViewDoc } from './schema';

/**
 * Compile a validated plugin document into an ordinary `PluginDef`
 * (docs/PLUGIN-LANGUAGE.md §12), so the harness's registry, permissions, approvals, widgets and
 * agent treat it exactly like any other plugin.
 */

export type CompileOptions = {
  /** Listed and reviewed by pkuinfo (registry.json `verified`). Unverified plugins start stricter. */
  verified: boolean;
  /** Public HTTP for the runner (the host's fetch). */
  fetch: PublicFetch;
  /** Where it was installed from (shown in the plugin page). */
  source?: string;
};

function fieldZod(f: FieldDef): z.ZodType {
  let t: z.ZodType;
  if (f.enum) t = f.enum.every((x) => typeof x === 'string') ? z.enum(f.enum as [string, ...string[]]) : z.union(f.enum.map((x) => z.literal(x)) as never);
  else
    switch (f.type ?? 'string') {
      case 'number':
      case 'integer': {
        let n = f.type === 'integer' ? z.number().int() : z.number();
        if (f.min !== undefined) n = n.min(f.min);
        if (f.max !== undefined) n = n.max(f.max);
        t = n;
        break;
      }
      case 'boolean':
        t = z.boolean();
        break;
      case 'array': {
        let a = z.array(f.items ? fieldZod(f.items) : z.unknown());
        if (f.min !== undefined) a = a.min(f.min);
        if (f.max !== undefined) a = a.max(f.max);
        t = a;
        break;
      }
      case 'object':
        t = z.record(z.string(), z.unknown());
        break;
      default: {
        let s = f.trim ? z.string().trim() : z.string();
        if (f.min !== undefined) s = s.min(f.min);
        if (f.max !== undefined) s = s.max(f.max);
        if (f.pattern) s = s.regex(new RegExp(f.pattern));
        t = s;
      }
    }
  if (f.description) t = t.describe(f.description);
  if (f.default !== undefined) return t.default(f.default as never);
  return f.optional ? t.optional() : t;
}

export function inputZod(fields: Record<string, FieldDef> = {}) {
  return z.object(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, fieldZod(f)])));
}

const STRICT: Record<ToolEffect, 'auto' | 'ask' | 'off'> = { read: 'auto', write: 'ask', money: 'ask', public: 'ask' };
const RANK = { auto: 0, ask: 1, off: 2 } as const;

/** Tool ids in bindings may be short (`free`) or full (`classrooms.free`). */
function fullTool(pluginId: string, tool: string) {
  return tool.includes('.') ? tool : `${pluginId}.${tool}`;
}

/** The read tool that backs a `{ fn }` binding (widgets resolve bindings through tools). */
export const fnToolName = (fn: string) => `fn_${fn.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 40);

/**
 * `{ "$param": "pid" }` in binding args → the screen's route parameter (`/p/<plugin>/<screen>?pid=…`).
 * Route parameters are strings; when the bound tool's input field is a number, a numeric string
 * becomes a number.
 */
const isParam = (v: unknown) => !!v && typeof v === 'object' && typeof (v as { $param?: unknown }).$param === 'string';

function withParams(v: unknown, params: Record<string, string | undefined>, fields?: Record<string, FieldDef>, field?: string): unknown {
  if (Array.isArray(v)) return v.map((x) => withParams(x, params));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$param === 'string' && Object.keys(o).length === 1) {
      const raw = params[o.$param] ?? null;
      const type = field ? fields?.[field]?.type : undefined;
      if (raw !== null && (type === 'integer' || type === 'number') && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
      return raw;
    }
    // An absent route parameter leaves its field out, so optional inputs keep their default.
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, withParams(x, params, fields, k)]).filter(([k, x]) => x !== null || !isParam(o[k as string])));
  }
  return v;
}

/** `{name}` in a screen title → its route parameter (e.g. "树洞 #{pid}"). */
const titleWith = (title: string, params: Record<string, string | undefined>) => title.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? '');

/**
 * A widget or screen document rendered by the host's GenUI. Its state is the spec's state plus:
 * the bound data, `/params` (screen route parameters), `/size` (widget size) and `/t` (the
 * view's `strings` in the app language, zh-Hans fallback).
 */
/** `a.b[0]` into a value (binding `path`). */
export function atPath(v: unknown, path?: string): unknown {
  if (!path) return v;
  let cur = v;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) cur = cur == null ? undefined : (cur as Record<string, unknown>)[part];
  return cur;
}

/** Set a JSON pointer like /pay or /card/code in a state object (copying along the way). */
export function setPointer(state: Record<string, unknown>, ptr: string, value: unknown): Record<string, unknown> {
  const keys = ptr.split('/').slice(1).map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'));
  const out = { ...state };
  let cur = out;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else cur = cur[k] = { ...((cur[k] as Record<string, unknown>) ?? {}) };
  });
  return out;
}

type LiveBinding = { tool: string; args?: Record<string, unknown>; path?: string; refreshSeconds: number };

/**
 * `refreshSeconds` bindings: run the tools as the user when the screen opens and again every N
 * seconds, in memory only (never the widget cache, so a payment code never reaches disk and an
 * old one is never shown). Nothing until the first answer arrives.
 */
function useLive(invoke: PluginScreenProps['invoke'] | undefined, live: [string, LiveBinding][], key: string, nowMs: number) {
  const [state, setState] = useState<{ values: Record<string, unknown> | null; error: string | null; next: number }>({ values: null, error: null, next: 0 });
  useEffect(() => {
    if (!live.length || !invoke) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const every = Math.min(...live.map(([, b]) => b.refreshSeconds)) * 1000;
    const tick = async () => {
      try {
        const values: Record<string, unknown> = {};
        for (const [ptr, b] of live) values[ptr] = atPath(await invoke(b.tool, b.args ?? {}), b.path);
        if (alive) setState({ values, error: null, next: Date.now() + every });
      } catch (e) {
        if (alive) setState({ values: null, error: e instanceof Error ? e.message : String(e), next: Date.now() + every });
      }
      if (alive) timer = setTimeout(() => void tick(), every);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { ...state, refreshIn: state.next ? Math.max(0, Math.ceil((state.next - nowMs) / 1000)) : null };
}

function viewComponent(pluginId: string, view: ViewDoc, tools: Record<string, ToolDoc> = {}, campus = false): ComponentType<PluginWidgetProps | PluginScreenProps> {
  const spec = view.spec as Record<string, unknown> & { state?: Record<string, unknown> };
  const all = Object.entries(view.bindings ?? {});
  const hasLive = all.some(([, b]) => b.refreshSeconds);
  function DocView(props: PluginWidgetProps | PluginScreenProps) {
    const { host } = props;
    const params = ('params' in props ? props.params : undefined) ?? {};
    const size = 'size' in props ? props.size : undefined;
    const locale = host.useLocale();
    const key = JSON.stringify(params);
    const resolved = useMemo(
      () =>
        all.map(([ptr, { fn, tool, args, ...b }]) => [
            ptr,
            {
              ...b,
              ...(args ? { args: withParams(args, params, tool && !tool.includes('.') ? tools[tool]?.input : undefined) as Record<string, unknown> } : {}),
              tool: fn ? `${pluginId}.${fnToolName(fn)}` : fullTool(pluginId, tool!),
            },
          ] as const),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [key],
    );
    const bindings = useMemo(() => Object.fromEntries(resolved.filter(([, b]) => !b.refreshSeconds)), [resolved]);
    const now = hasLive ? host.useNow(1000).getTime() : 0;
    const live = useLive(hasLive ? props.invoke : undefined, resolved.filter(([, b]) => b.refreshSeconds) as [string, LiveBinding][], key, now);
    const data = host.useWidgetData({ spec, bindings });
    const { GenUI, Skeleton, Text } = host.components;
    const t = { ...(view.strings?.['zh-Hans'] ?? {}), ...(locale === 'en' ? (view.strings?.en ?? {}) : {}) };
    if (data.status === 'loading' || (hasLive && !live.values && !live.error)) return createElement(Skeleton, { height: 56 });
    const fallback = locale === 'en' ? 'Couldn’t load' : '加载失败';
    if (data.status === 'error' && !data.value) return createElement(Text, { variant: 'caption', tone: 'muted' } as never, data.error ?? fallback);
    // A failed refresh drops the live value: an expired payment code is never left on screen.
    if (hasLive && !live.values) return createElement(Text, { variant: 'caption', tone: 'muted' } as never, live.error ?? fallback);
    let state: Record<string, unknown> = { ...(spec.state ?? {}), ...(data.value ?? {}), params, size: size ?? null, t };
    for (const [ptr, v] of Object.entries(live.values ?? {})) state = setPointer(state, ptr, v);
    if (hasLive) state.refreshIn = live.refreshIn;
    if (campus) state.account = { signedIn: accountOf(props.services).signedIn };
    return createElement(GenUI, { spec: { ...spec, state } });
  }
  return DocView;
}

function screenComponent(pluginId: string, view: ViewDoc, tools: Record<string, ToolDoc>, enTitle?: string, campus = false): ComponentType<PluginScreenProps> {
  const Body = viewComponent(pluginId, view, tools, campus) as ComponentType<PluginScreenProps>;
  const secure = view.secure;
  function DocScreen(props: PluginScreenProps) {
    // `secure` is fixed per screen, so the hook is called on every render or on none.
    if (secure) props.host.useSecureDisplay({ brightness: secure.brightness ?? false });
    const { Screen } = props.host.components;
    const title = props.host.useLocale() === 'en' && enTitle ? enTitle : view.title;
    return createElement(Screen, { title: titleWith(title, props.params ?? {}), back: true, children: createElement(Body, props) });
  }
  return DocScreen;
}

function translation(doc: PluginDocument): PluginTranslation | undefined {
  const en = doc.manifest.i18n?.en;
  if (!en) return undefined;
  const { instructions: _ignored, ...rest } = en;
  return rest as PluginTranslation;
}

function accountOf(services: { campus?: { status?: () => { signedIn: boolean; username: string | null } } }) {
  try {
    const st = services.campus?.status?.();
    return { signedIn: !!st?.signedIn, username: st?.username ?? null };
  } catch {
    return { signedIn: false, username: null };
  }
}

export function compilePlugin(doc: PluginDocument, opts: CompileOptions): PluginDef {
  const m = doc.manifest;
  const requires = new Set<Capability>(m.requires ?? []);
  if (m.campus?.length) requires.add('campus-session');
  if (m.network?.length || m.remote) requires.add('network');
  if (m.cloud || m.server) requires.add('cloud');

  const tools: Record<string, ToolDef> = {};
  // Files the user picked in this plugin's screens, for this app session (RunEnv.picked).
  const picked = new Map<string, { name: string; mime: string }>();
  for (const [name, t] of Object.entries(doc.tools)) {
    tools[name] = {
      title: t.title,
      description: t.description,
      input: inputZod(t.input),
      effect: t.effect,
      untrusted: t.untrusted ?? !opts.verified,
      userOnly: t.userOnly,
      dayScoped: t.dayScoped,
      execute: async (input, ctx) => {
        try {
          // Plugins that declare campus services may read who is signed in (the student ID some
          // campus pages need, e.g. elective's xh); never the password or the holder's name.
          const scope = m.campus?.length ? { account: accountOf(ctx.services) } : undefined;
          return await runTool({ manifest: m, tools: doc.tools, services: ctx.services, kv: ctx.kv, fetch: opts.fetch, signal: ctx.signal, cloud: ctx.cloud, scope, picked }, name, input as Record<string, unknown>);
        } catch (e) {
          throw e instanceof ToolFailure ? new Error(e.message) : e;
        }
      },
    };
  }

  // `{ fn }` bindings: one read tool per bound server function, calling it through ctx.cloud
  // (non-interactive for widgets: a missing consent fails with consent_required, no sheet).
  const fns = serverFunctions(m);
  for (const view of [...Object.values(doc.widgets), ...Object.values(doc.screens)])
    for (const b of Object.values(view.bindings ?? {})) {
      if (!b.fn || tools[fnToolName(b.fn)]) continue;
      const fn = b.fn;
      tools[fnToolName(fn)] = {
        title: fns[fn]?.title ?? fn,
        description: `Server function ${fn} of this plugin (read).${fns[fn]?.description ? ` ${fns[fn]!.description}` : ''}`,
        input: z.record(z.string(), z.unknown()),
        effect: 'read',
        untrusted: true,
        execute: async (input, ctx) => {
          if (!ctx.cloud) throw new Error('this plugin has no cloud connection');
          return ctx.cloud.functions.invoke(fn, input ?? {}, { signal: ctx.signal });
        },
      };
    }

  // A server: section means the plugin uses server functions (CLOUD-FUNCTIONS.md); the
  // disclosure is the author's (required by the validator).
  const cloud = m.server
    ? ({ protocol: 1, e2e: false, ...(m.cloud ?? {}), uses: [...new Set([...(((m.cloud as { uses?: string[] })?.uses) ?? []), 'functions'])] } as PluginDef['cloud'])
    : (m.cloud as PluginDef['cloud']);

  const defaultModes: Partial<Record<ToolEffect, 'auto' | 'ask' | 'off'>> = { ...(m.defaultModes ?? {}) };
  if (!opts.verified)
    for (const e of Object.keys(STRICT) as ToolEffect[]) {
      const asked = defaultModes[e];
      defaultModes[e] = asked && RANK[asked] > RANK[STRICT[e]] ? asked : STRICT[e];
    }

  return {
    id: m.id,
    name: m.name,
    description: m.description,
    version: m.version,
    icon: m.icon,
    requires: [...requires],
    cloud,
    scopes: [...(m.network ?? []), ...(m.campus ?? []).map((s) => `campus:${s}`)],
    defaultModes,
    tools,
    dataSources: m.dataSources
      ? Object.fromEntries(Object.entries(m.dataSources).map(([k, d]) => [k, { title: d.title ?? doc.tools[d.tool]?.title ?? k, tool: d.tool, args: d.args, ttlMs: durationMs(d.ttl) }]))
      : undefined,
    instructions: doc.instructions || undefined,
    // Taking over another plugin's ids moves the user's saved checks and widgets: official plugins only.
    ...(m.legacy && opts.verified ? { legacy: m.legacy } : {}),
    contributes: {
      commands: m.commands
        ? Object.fromEntries(
            Object.entries(m.commands).map(([k, c]) => {
              const base = { description: c.description, aliases: c.aliases, argHint: c.argHint };
              if (!c.screen) return [k, { ...base, prompt: c.prompt }];
              const href = `/${doc.screens[c.screen]?.presentation === 'modal' ? 'm' : 'p'}/${m.id}/${c.screen}`;
              return [k, { ...base, run: (_input: string, ctx: { navigate: (href: string) => void }) => ctx.navigate(href) }];
            }),
          )
        : undefined,
      widgets: Object.keys(doc.widgets).length
        ? Object.fromEntries(
            Object.entries(doc.widgets).map(([k, v]) => [k, { title: v.title, description: v.description ?? v.title, sizes: v.sizes, defaultSize: v.defaultSize, component: viewComponent(m.id, v, doc.tools, !!m.campus?.length) as ComponentType<PluginWidgetProps> }]),
          )
        : undefined,
      screens: Object.keys(doc.screens).length ? Object.fromEntries(Object.entries(doc.screens).map(([k, v]) => [k, { title: v.title, presentation: v.presentation, component: screenComponent(m.id, v, doc.tools, m.i18n?.en?.screens?.[k]?.title, !!m.campus?.length) }])) : undefined,
      settings: m.settings,
    },
    i18n: translation(doc) ? { en: translation(doc) } : undefined,
  };
}
