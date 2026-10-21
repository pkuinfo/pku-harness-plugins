import type { z } from 'zod';

import type { CampusRequest, CampusResponse, CampusService, CampusStatus, OtpCode, OtpStatus, PickedFile } from './campus';
import type { Binding, Widget, WidgetSize } from './dashboard';
import type { SpecCheck, UISpec } from './genui';
import type { NotifyFixKind, NotifyReadiness } from './notify';
import type { Action, Job, JobSource, Trigger } from './scheduler/types';
import type { Course, Semester } from './timetable';
import type { Todo, TodoInput } from './todo';
import type { Contributions } from './ui';

/**
 * The plugin contract of PKU Harness. The app is only a harness: it runs plugins, gives them
 * host services through `ctx.services`, and renders their output. Built-in and community
 * plugins use exactly this contract; none can import app internals.
 */

/** English (etc.) overlay for a plugin's user-facing manifest strings (see PluginDef.i18n). */
export type PluginTranslation = {
  name?: string;
  description?: string;
  /** Tool titles shown in chat chips, approvals and Settings, keyed by tool name. */
  tools?: Record<string, { title?: string }>;
  widgets?: Record<string, { title?: string; description?: string }>;
  screens?: Record<string, { title?: string }>;
  /** Settings rows, keyed by the screen they open. */
  settings?: Record<string, { title?: string; subtitle?: string }>;
  /** `prompt`: the English template for prompt commands (sent as the user's message). */
  commands?: Record<string, { description?: string; argHint?: string; aliases?: string[]; prompt?: string }>;
  /** Provider plugins: display name, description, credential hint and model names/descriptions. */
  providers?: Record<string, { name?: string; description?: string; credentialHint?: string; models?: Record<string, { name?: string; description?: string }> }>;
  dataSources?: Record<string, { title?: string }>;
};

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
export interface WidgetCatalogEntry {
  plugin: string;
  pluginName: string;
  widget: string;
  title: string;
  description: string;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  /** JSON Schema of the widget's config, if it takes any. */
  config?: Record<string, unknown>;
}

export interface HostServices {
  /**
   * Hand the user to a web page in the system browser tab (Custom Tabs / SFSafariViewController),
   * outside the app: a payment cashier, a login the harness can't do, a document. App links on
   * that page (weixin://, alipays://, …) open those apps, so a checkout can end in WeChat Pay or
   * Alipay. Resolves once the page is open (it doesn't wait for the user, and can't tell whether
   * a payment went through), so re-read the result (e.g. a balance) when the user is back.
   */
  browser: {
    open(url: string): Promise<{ opened: true }>;
  };
  /**
   * Let the user choose local files with the system picker (for uploads such as Blackboard
   * submissions). Only the user can pick: call it from a screen in response to a tap, never from
   * an agent tool. Resolves [] when the user cancels. Files are copied into the app's cache, so
   * the URIs stay readable for this app session; the plugin gets references, not bytes.
   */
  files: {
    pick(opts?: { /** MIME types, wildcards allowed (e.g. ['application/pdf', 'image/*']); default any. */ types?: string[]; multiple?: boolean }): Promise<PickedFile[]>;
  };
  /** Hashing for request signatures (plugins have no crypto of their own). */
  crypto: {
    /** SHA-256 of the UTF-8 text, lowercase hex. */
    sha256(text: string): Promise<string>;
  };
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
  /**
   * Whether reminders and checks can fire and notify on the minute (notification permission,
   * exact alarms, battery optimisation), so a screen can warn and offer a fix. `fix` shows the
   * system prompt or opens the system screen for that item; call it only in response to a tap.
   * It resolves with the readiness re-read afterwards (system screens may return before the
   * user changes anything: re-read when the app is back in the foreground too).
   */
  notify: {
    readiness(): Promise<NotifyReadiness>;
    fix(kind: NotifyFixKind): Promise<NotifyReadiness>;
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
    /** Resolve bindings through the TTL cache (`force` refetches). */
    resolve(widget: Widget, force?: boolean): Promise<Record<string, unknown>>;
    /** Native widgets that enabled plugins contribute (`contributes.widgets`). */
    catalog(): WidgetCatalogEntry[];
  };
  todos: {
    list(): Todo[];
    get(id: string): Todo | undefined;
    add(input: TodoInput, source: JobSource): Promise<Todo>;
    update(id: string, patch: Partial<TodoInput>, source: JobSource): Promise<Todo>;
    setDone(id: string, done: boolean): Promise<Todo>;
    remove(id: string): Promise<void>;
  };
  /** Signed-in campus services (requires the 'campus-session' capability). */
  campus: {
    status(): CampusStatus;
    request(service: CampusService, req: CampusRequest): Promise<CampusResponse>;
    /**
     * Current IAAA 手机令牌 code when the user bound the harness's authenticator, else null.
     * For second factors such as treehole's course token (40077). Never the secret.
     */
    otp(): Promise<OtpCode | null>;
    /** Authenticator management, for the bundled authenticator plugin's screens only. */
    otpStatus(): Promise<OtpStatus>;
    /** Verify the stored credentials with IAAA and send the binding SMS; returns the masked phone. */
    otpBindStart(): Promise<{ sentTo: string | null }>;
    /** Finish binding with the SMS code: IAAA's 手机令牌 now points at this device. */
    otpBindFinish(smsCode: string): Promise<OtpStatus>;
    /** Forget the secret on this device (IAAA keeps the binding). */
    otpUnbindLocal(): Promise<void>;
    /**
     * Open a campus site in the system browser already signed in (the service's own hand-off),
     * e.g. to pay an order the plugin created. The harness builds the URL; the plugin never sees
     * the session token. Rejects when the service has no hand-off.
     */
    openSignedIn(service: CampusService): Promise<{ opened: true }>;
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

/**
 * The agent turn a tool call belongs to (only for `actor: 'agent'` calls made in a chat turn).
 * `tainted`: earlier in this turn the agent called a tool that returns third-party content
 * (`ToolDef.untrusted`, any remote plugin), so its next actions may be steered by text the user
 * never wrote (prompt injection). Durable writes such as memory should then wait for the user.
 */
export interface TurnInfo {
  sessionId?: string;
  tainted: boolean;
  /**
   * The user's own message in this turn asks to remember something ("记住…", "remember…").
   * Third-party content can't write the user's message, so such a write is the user's intent
   * even when the turn is tainted.
   */
  userAsked?: boolean;
}

export interface ToolContext {
  pluginId: string;
  actor: Actor;
  /** Set for agent calls inside a chat turn. */
  turn?: TurnInfo;
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
  /**
   * Returns content written by third parties (forum posts, notices, event blurbs). Calling it
   * taints the agent's turn (`ToolContext.turn.tainted`). Remote plugins' tools always count.
   */
  untrusted?: boolean;
  /**
   * Only the user can run it, from a screen: it is not offered to the model, and agent or
   * scheduler calls are refused. For gates the agent must not open itself (approving a memory).
   */
  userOnly?: boolean;
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
  /** Context window in tokens (drives the context meter and auto-compaction). Unknown: 128k assumed. */
  contextWindow?: number;
  /** What the model accepts besides text; image attachments are only offered when 'image' is listed. */
  inputModalities?: ('text' | 'image')[];
  /** Published prices, for the host's local cost ledger (usage board). Omitted = cost unknown. */
  pricing?: ModelPricing;
}

/**
 * Prices per 1M tokens in `currency`. The base prices are the flat (or off-peak) ones; `peak`
 * multiplies them inside its windows. Input is split by prefix-cache hit vs miss.
 */
export interface ModelPricing {
  currency: 'CNY' | 'USD';
  inputCacheHit: number;
  inputCacheMiss: number;
  output: number;
  /** Peak windows in the provider's time zone: weekdays (0 = Sunday) and [startHour, endHour) ranges. */
  peak?: { multiplier: number; utcOffsetMinutes: number; weekdays: number[]; hours: [number, number][] };
  /** Where the numbers come from (URL + date checked), shown next to estimates. */
  source?: string;
}

/** Account balance as the provider reports it (one entry per currency). */
export interface ProviderBalance {
  currency: string;
  total: number;
  granted?: number;
  toppedUp?: number;
}

export interface ProviderAccount {
  /** The provider says the balance is enough to make calls. */
  available: boolean;
  balances: ProviderBalance[];
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
  /** Read the account balance with the user's own credential (e.g. DeepSeek GET /user/balance). */
  balance?: (config: ProviderConfig) => Promise<ProviderAccount>;
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
  /** UI the plugin adds to the harness (screens, Settings rows), built from `HostUI`. */
  contributes?: Contributions;
  /**
   * Translations of this manifest's user-facing strings (the Chinese fields above are the
   * source). The host shows them when the app language matches; anything missing falls back
   * to Chinese. Tool descriptions and `instructions` are for the model and stay as they are.
   */
  i18n?: { en?: PluginTranslation };
}

export interface ContextInput {
  /** The user's latest message. */
  query: string;
  kv: KV;
  services: HostServices;
}

/**
 * Markers for context lines that retract a fact shown earlier (docs/AGENT-HARNESS.md §5.1).
 * `- [已删除] old` and `- [更正] old → new`: the host appends them only to chats whose history
 * still shows `old`, once. Fact texts must not contain the arrow.
 */
export const CONTEXT_MARK = { deleted: '[已删除]', corrected: '[更正]', arrow: ' → ' } as const;

export function definePlugin(def: PluginDef): PluginDef {
  return def;
}

export function defineTool<I extends z.ZodType, O>(def: ToolDef<I, O>): ToolDef {
  return def as unknown as ToolDef;
}

export type { Binding, Widget, WidgetSize, UISpec };
