import type { z } from 'zod';

import type { Binding, Widget, WidgetSize } from './dashboard';
import type { SpecCheck, UISpec } from './genui';
import type { Action, Job, JobSource, Trigger } from './scheduler/types';
import type { Course, Semester } from './timetable';
import type { Todo, TodoInput } from './todo';

/**
 * The plugin contract of PKU Harness. The app is only a harness: it runs plugins, gives them
 * host services through `ctx.services`, and renders their output. Built-in and community
 * plugins use exactly this contract; none can import app internals.
 */

/** What a tool changes. Drives per-plugin permission modes in the app. */
export type ToolEffect = 'read' | 'write' | 'money' | 'public';

/** Who invoked a tool. */
export type Actor = 'user' | 'agent' | 'scheduler';

/**
 * Things a plugin may need from the device. A phone is not a workstation: there is no shell or
 * filesystem, background time is limited, and some campus hosts only answer on the campus
 * network. The host hides plugins whose requirements it can't meet (remote MCP is the
 * fallback for anything heavier).
 */
export type Capability =
  | 'network' // general internet access
  | 'campus-network' // hosts reachable only from the PKU network
  | 'campus-session' // authenticated campus HTTP via the host (credentials never exposed)
  | 'notifications'
  | 'background' // periodic background execution
  | 'shell' // never available on phones; plugins needing it must run remotely
  | 'filesystem';

/** Minimal namespaced JSON store each plugin gets. */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export type ToolInfo = { id: string; pluginId: string; title: string; effect: ToolEffect };

export type PluginInfo = {
  id: string;
  name: string;
  kind: 'system' | 'builtin' | 'remote';
  enabled: boolean;
  modes: Record<ToolEffect, 'auto' | 'ask' | 'off'>;
  tools: { id: string; title: string; effect: ToolEffect }[];
};

export type JobInput = { title: string; trigger: Trigger; action: Action; source: JobSource; enabled?: boolean; meta?: Record<string, unknown> };
export type JobPatch = Partial<Pick<Job, 'title' | 'trigger' | 'action' | 'enabled' | 'meta'>>;
export type CheckResult = { notified: boolean; value?: unknown; error?: string };

/** Services the harness provides. Everything a plugin does outside itself goes through here. */
export interface HostServices {
  /** Introspection of installed plugins and tools (read-only). */
  registry: {
    plugins(): PluginInfo[];
    tool(id: string): ToolInfo | undefined;
  };
  /** Remote (MCP) plugin management. */
  remote: {
    install(input: { url: string; name?: string; token?: string }): Promise<{ id: string; name: string; tools: { name: string; effect: ToolEffect }[] }>;
    uninstall(id: string): Promise<void>;
    has(id: string): boolean;
  };
  /** The host's generative-UI catalog (its design system). */
  genui: {
    describeCatalog(): string;
    checkSpec(spec: unknown): SpecCheck;
  };
  /** Exact notifications and scheduled checks. */
  scheduler: {
    create(input: JobInput): Promise<Job>;
    update(id: string, patch: JobPatch): Promise<Job>;
    remove(id: string): Promise<void>;
    get(id: string): Job | undefined;
    list(): Job[];
    runCheck(id: string): Promise<CheckResult>;
  };
  /** Dashboard widgets. */
  widgets: {
    list(): Widget[];
    get(id: string): Widget | undefined;
    newId(): string;
    put(widget: Widget): Promise<void>;
    remove(id: string): Promise<void>;
    reorder(ids: string[]): Promise<void>;
    /** Resolve bindings now; returns the state the spec will see. */
    preview(widget: Widget): Promise<Record<string, unknown>>;
  };
  todos: {
    list(): Todo[];
    get(id: string): Todo | undefined;
    add(input: TodoInput, source: JobSource): Promise<Todo>;
    update(id: string, patch: Partial<TodoInput>, source: JobSource): Promise<Todo>;
    setDone(id: string, done: boolean): Promise<Todo>;
    remove(id: string): Promise<void>;
  };
  timetable: {
    get(): { courses: Course[]; semester: Semester | null; reminderMinutes: number | null };
    newId(): string;
    upsert(course: Course): Promise<void>;
    remove(id: string): Promise<void>;
    setReminderMinutes(minutes: number | null): Promise<void>;
    /** Re-read the semester (after the calendar plugin saved it). */
    reloadSemester(): Promise<void>;
  };
}

/** A value, or a function of the host services resolved when the host builds the prompt. */
export type Dynamic<T> = T | ((services: HostServices) => T);

export function resolveDynamic<T>(value: Dynamic<T>, services: HostServices): T {
  return typeof value === 'function' ? (value as (s: HostServices) => T)(services) : value;
}

export interface ToolContext {
  pluginId: string;
  actor: Actor;
  /** This plugin's private store. */
  kv: KV;
  services: HostServices;
  signal?: AbortSignal;
}

export interface ToolDef<I extends z.ZodType = z.ZodType, O = unknown> {
  title: string;
  /** Written for the model: when and how to use this tool. A function can read host info. */
  description: Dynamic<string>;
  input: I;
  effect: ToolEffect;
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<O>;
}

export interface DataSourceDef {
  title: string;
  tool: string;
  args?: Record<string, unknown>;
  ttlMs: number;
}

/** How a model provider authenticates. `account` = sign-in / subscription owned by the plugin. */
export type ProviderAuth = 'apiKey' | 'account' | 'none';

export interface ProviderModel {
  id: string;
  name?: string;
  description?: string;
}

export interface ProviderConfig {
  baseURL: string;
  model: string;
  /** API key or account token from the host's secure storage. */
  credential?: string;
  /** Streaming fetch provided by the host (e.g. expo/fetch). */
  fetch: typeof fetch;
}

/** A model provider. `createModel` returns an AI SDK `LanguageModel` (typed loosely here). */
export interface ProviderDef {
  name: string;
  description: string;
  auth: ProviderAuth;
  defaultBaseURL: string;
  editableBaseURL?: boolean;
  models: ProviderModel[];
  defaultModel: string;
  credentialHint?: string;
  listModels?: (config: ProviderConfig) => Promise<ProviderModel[]>;
  signIn?: () => Promise<string>;
  createModel: (config: ProviderConfig) => unknown;
}

export interface PluginDef {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Icon name from the host's icon set (e.g. 'card', 'book', 'alarm'). */
  icon?: string;
  /** Part of the harness experience: always on, can't be disabled. */
  core?: boolean;
  /** What the plugin needs from the device; unmet requirements hide it (see Capability). */
  requires?: Capability[];
  /** Remote (MCP) plugin: where its tools run. Set by the host for installed remote plugins. */
  remote?: { url: string; server: string };
  /** Default per-effect modes; the user can change them. */
  defaultModes?: Partial<Record<ToolEffect, 'auto' | 'ask' | 'off'>>;
  /** Campus services or hosts this plugin talks to, shown to the user. */
  scopes: string[];
  tools: Record<string, ToolDef>;
  dataSources?: Record<string, DataSourceDef>;
  providers?: Record<string, ProviderDef>;
  /** Extra guidance appended to the agent's system prompt. */
  instructions?: Dynamic<string>;
  /**
   * Request context (as in DeepSeek Harness's context plugins): called before each agent turn
   * with the user's message; returned text is shown to the model for that turn, marked as data.
   * Keep it short and relevant — it costs tokens on every request.
   */
  context?: (input: ContextInput) => Promise<string | undefined>;
}

export interface ContextInput {
  /** The user's latest message. */
  query: string;
  kv: KV;
  services: HostServices;
}

export function definePlugin(def: PluginDef): PluginDef {
  return def;
}

export function defineTool<I extends z.ZodType, O>(def: ToolDef<I, O>): ToolDef {
  return def as unknown as ToolDef;
}

export type { Binding, Widget, WidgetSize, UISpec };
