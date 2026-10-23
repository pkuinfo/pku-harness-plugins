import { createElement, type ComponentType } from 'react';
import { z } from 'zod';

import type { Capability, PluginDef, PluginTranslation, ToolDef, ToolEffect } from '../plugin';
import type { PluginScreenProps, PluginWidgetProps } from '../ui';
import type { PluginDocument } from './load';
import { runTool, ToolFailure, type PublicFetch } from './run';
import { durationMs, type FieldDef, type ViewDoc } from './schema';

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
        let s = z.string();
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

function viewComponent(pluginId: string, view: ViewDoc): ComponentType<PluginWidgetProps | PluginScreenProps> {
  const bindings = Object.fromEntries(Object.entries(view.bindings ?? {}).map(([ptr, b]) => [ptr, { ...b, tool: fullTool(pluginId, b.tool) }]));
  const spec = view.spec as Record<string, unknown> & { state?: Record<string, unknown> };
  function DocView({ host }: PluginWidgetProps | PluginScreenProps) {
    const data = host.useWidgetData({ spec, bindings });
    const { GenUI, Skeleton, Text } = host.components;
    if (data.status === 'loading') return createElement(Skeleton, { height: 56 });
    if (data.status === 'error' && !data.value) return createElement(Text, { variant: 'caption', tone: 'muted' } as never, data.error ?? '加载失败');
    return createElement(GenUI, { spec: { ...spec, state: { ...(spec.state ?? {}), ...(data.value ?? {}) } } });
  }
  return DocView;
}

function screenComponent(pluginId: string, view: ViewDoc): ComponentType<PluginScreenProps> {
  const Body = viewComponent(pluginId, view) as ComponentType<PluginScreenProps>;
  function DocScreen(props: PluginScreenProps) {
    const { Screen } = props.host.components;
    return createElement(Screen, { title: view.title, back: true, children: createElement(Body, props) });
  }
  return DocScreen;
}

function translation(doc: PluginDocument): PluginTranslation | undefined {
  const en = doc.manifest.i18n?.en;
  if (!en) return undefined;
  const { instructions: _ignored, ...rest } = en;
  return rest as PluginTranslation;
}

export function compilePlugin(doc: PluginDocument, opts: CompileOptions): PluginDef {
  const m = doc.manifest;
  const requires = new Set<Capability>(m.requires ?? []);
  if (m.campus?.length) requires.add('campus-session');
  if (m.network?.length || m.remote) requires.add('network');
  if (m.cloud) requires.add('cloud');

  const tools: Record<string, ToolDef> = {};
  for (const [name, t] of Object.entries(doc.tools)) {
    tools[name] = {
      title: t.title,
      description: t.description,
      input: inputZod(t.input),
      effect: t.effect,
      untrusted: t.untrusted ?? !opts.verified,
      userOnly: t.userOnly,
      execute: async (input, ctx) => {
        try {
          return await runTool({ manifest: m, tools: doc.tools, services: ctx.services, kv: ctx.kv, fetch: opts.fetch, signal: ctx.signal, cloud: ctx.cloud }, name, input as Record<string, unknown>);
        } catch (e) {
          throw e instanceof ToolFailure ? new Error(e.message) : e;
        }
      },
    };
  }

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
    cloud: m.cloud as PluginDef['cloud'],
    scopes: [...(m.network ?? []), ...(m.campus ?? []).map((s) => `campus:${s}`)],
    defaultModes,
    tools,
    dataSources: m.dataSources
      ? Object.fromEntries(Object.entries(m.dataSources).map(([k, d]) => [k, { title: d.title ?? doc.tools[d.tool]?.title ?? k, tool: d.tool, args: d.args, ttlMs: durationMs(d.ttl) }]))
      : undefined,
    instructions: doc.instructions || undefined,
    contributes: {
      commands: m.commands ? Object.fromEntries(Object.entries(m.commands).map(([k, c]) => [k, { description: c.description, aliases: c.aliases, argHint: c.argHint, prompt: c.prompt }])) : undefined,
      widgets: Object.keys(doc.widgets).length
        ? Object.fromEntries(
            Object.entries(doc.widgets).map(([k, v]) => [k, { title: v.title, description: v.description ?? v.title, sizes: v.sizes, defaultSize: v.defaultSize, component: viewComponent(m.id, v) as ComponentType<PluginWidgetProps> }]),
          )
        : undefined,
      screens: Object.keys(doc.screens).length ? Object.fromEntries(Object.entries(doc.screens).map(([k, v]) => [k, { title: v.title, presentation: v.presentation, component: screenComponent(m.id, v) }])) : undefined,
      settings: m.settings,
    },
    i18n: translation(doc) ? { en: translation(doc) } : undefined,
  };
}
