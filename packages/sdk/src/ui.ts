import type { ComponentType, ReactNode } from 'react';

import type { z } from 'zod';

import type { PluginCloud, SecretLink } from './cloud';
import type { Binding, Widget, WidgetSize } from './dashboard';
import type { HostServices, KV } from './plugin';

/**
 * The harness's UI kit, handed to plugin screens as props. Plugins build their screens from
 * these components (the app's design system: native controls, tokens, motion), so a plugin's
 * UI looks native to the app and never imports app code. Styles are passed through as-is.
 */

type Style = unknown;
type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'up' | 'down' | 'warn' | 'info' | 'onAccent';
type ChipTone = 'neutral' | 'accent' | 'up' | 'down' | 'warn' | 'info';
type TextVariant = 'display' | 'title' | 'headline' | 'body' | 'bodyStrong' | 'callout' | 'caption' | 'micro' | 'numberXL' | 'numberL' | 'numberM';

export interface HostComponents {
  Screen: ComponentType<{ title: string; subtitle?: string; back?: boolean; trailing?: ReactNode; children: ReactNode; refreshControl?: ReactNode }>;
  Text: ComponentType<{ variant?: TextVariant; tone?: Tone; align?: 'left' | 'center' | 'right'; numberOfLines?: number; selectable?: boolean; style?: Style; children?: ReactNode }>;
  Button: ComponentType<{ title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: string; loading?: boolean; disabled?: boolean; style?: Style }>;
  IconButton: ComponentType<{ icon: string; label: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: number; disabled?: boolean }>;
  ListGroup: ComponentType<{ title?: string; footer?: string; children: ReactNode }>;
  ListRow: ComponentType<{ icon?: string; title: string; subtitle?: string; value?: string; accessory?: ReactNode; onPress?: () => void; chevron?: boolean; titleLines?: number }>;
  Chip: ComponentType<{ label: string; tone?: ChipTone; icon?: string }>;
  Surface: ComponentType<{ level?: 1 | 2 | 3; padded?: boolean; children?: ReactNode; style?: Style }>;
  EmptyState: ComponentType<{ icon: string; title: string; message?: string; action?: ReactNode }>;
  Skeleton: ComponentType<{ width?: number | `${number}%`; height?: number; rounded?: number }>;
  FadeIn: ComponentType<{ index?: number; children: ReactNode; style?: Style }>;
  Icon: ComponentType<{ name: string; size?: number; color?: string }>;
  Stat: ComponentType<{ label: string; value: number | null; prefix?: string; suffix?: string; decimals?: number; caption?: string; icon?: string }>;
  Switch: ComponentType<{ value: boolean; onValueChange: (v: boolean) => void; label?: string; disabled?: boolean }>;
  Checkbox: ComponentType<{ value: boolean; onValueChange: (v: boolean) => void; label: string }>;
  Segmented: ComponentType<{ options: { label: string; value: string }[]; value: string; onChange: (v: string) => void }>;
  Row: ComponentType<{ gap?: 'xs' | 'sm' | 'md' | 'lg'; align?: 'start' | 'center' | 'end' | 'between'; children: ReactNode }>;
  Column: ComponentType<{ gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; children: ReactNode }>;
  /** Tappable container with the app's press feedback. */
  Pressable: ComponentType<{ onPress?: () => void; onLongPress?: () => void; delayLongPress?: number; accessibilityLabel?: string; accessibilityRole?: string; accessibilityHint?: string; scaleTo?: number; haptic?: boolean; disabled?: boolean; style?: Style; children?: ReactNode }>;
  /** Labelled text input. */
  Field: ComponentType<{ label?: string; value: string; onChangeText: (v: string) => void; placeholder?: string; hint?: string; multiline?: boolean; secureTextEntry?: boolean; autoFocus?: boolean; keyboardType?: string; autoCapitalize?: 'none' | 'sentences' }>;
  /** Native date/time picker field. */
  DateTimeField: ComponentType<{ label: string; value: Date | null; onChange: (d: Date) => void; mode?: 'date' | 'time' | 'datetime'; placeholder?: string; onClear?: () => void }>;
  Stepper: ComponentType<{ value: number; onChange: (n: number) => void; min?: number; max?: number; suffix?: string; label: string }>;
  WeekdayPicker: ComponentType<{ value: number[]; onChange: (v: number[]) => void; multiple?: boolean }>;
  /** Form sheet layout: title + close, scrolling body, primary (and optional secondary/danger) action. */
  SheetScreen: ComponentType<{ title: string; children: ReactNode; primary: string; onPrimary: () => void; primaryDisabled?: boolean; loading?: boolean; danger?: string; onDanger?: () => void; secondary?: string; onSecondary?: () => void }>;
  Sparkline: ComponentType<{ values: number[]; tone?: 'accent' | 'up' | 'down' | 'info'; height?: number }>;
  Ring: ComponentType<{ value: number; label?: string; caption?: string; tone?: 'accent' | 'up' | 'down' | 'warn'; size?: number }>;
  /**
   * Hourglass that drains over `period` seconds aligned to Unix time (boundaries at multiples of
   * `period` since the epoch, e.g. a TOTP window) and flips at each boundary; self-syncing.
   */
  Hourglass: ComponentType<{ period?: number; size?: number; tone?: 'accent' | 'up' | 'down' | 'warn' }>;
  /** Render a generative-UI spec with the host catalog. */
  GenUI: ComponentType<{ spec: Record<string, unknown>; onSubmit?: (form: Record<string, unknown>, label?: string) => void }>;
  /** Vertical list sortable by dragging a handle; rows are rendered by the plugin. */
  SortableList: ComponentType<{ ids: string[]; rowHeight: number; onReorder: (ids: string[]) => void; renderRow: (id: string, handle: ReactNode) => ReactNode }>;
  /** Mount a plugin-contributed dashboard widget (error-isolated; shows a notice if the plugin is off). */
  PluginWidget: ComponentType<{ source: { plugin: string; widget: string; config?: Record<string, unknown> }; size: WidgetSize }>;
  /**
   * The app's panel material: nearly transparent glass with a hairline edge and a top light
   * (iOS 26: system liquid glass). Pressable when given onPress. Use it for cards and tiles.
   */
  Glass: ComponentType<{ children?: ReactNode; style?: Style; radius?: number; tone?: 'regular' | 'strong' | 'brand'; onPress?: () => void; onLongPress?: () => void; accessibilityLabel?: string; accessibilityRole?: 'button' | 'summary' | 'none'; haptic?: boolean }>;
  /** Edge + top light for a container that paints its own `colors.surface*` fill (first child). */
  GlassEdges: ComponentType<{ radius?: number }>;
  /**
   * Scannable QR code (dark on white in every theme). Pass `value`, or `link` to encode a share
   * link the plugin can't read itself (`link` wins when both are set).
   */
  QRCode: ComponentType<{ value?: string; link?: SecretLink; size?: number; ecl?: 'L' | 'M' | 'Q' | 'H' }>;
}

/**
 * Live data from read tools, stale-while-revalidate: the last value (persisted across launches)
 * shows at once, and the host refetches when it is older than its TTL, on screen focus, when
 * the app returns to the foreground, every TTL while visible, and on `refresh()`. Same tool +
 * args share one request and one cache entry across widgets, screens and scheduled checks.
 */
export interface LiveData<T = unknown> {
  /** 'loading' only before the first value; afterwards errors keep the last value. */
  status: 'loading' | 'error' | 'ready';
  value?: T;
  /** Last refresh error (also set while a stale value is shown). */
  error?: string;
  /** When the shown value was fetched (ms epoch). */
  updatedAt?: number;
  /** A request is in flight. */
  fetching: boolean;
  /** Refetch now, ignoring the TTL. */
  refresh(): Promise<void>;
}

/** Design tokens and helpers for plugin layouts (styles are plain React Native styles). */
export interface HostTheme {
  name: 'light' | 'dark';
  colors: Record<'bg' | 'surface' | 'surface2' | 'surface3' | 'border' | 'text' | 'textMuted' | 'textFaint' | 'accent' | 'accentMuted' | 'onAccent' | 'up' | 'upMuted' | 'down' | 'downMuted' | 'warn' | 'warnMuted' | 'info' | 'infoMuted' | 'elevated' | 'brand' | 'onBrand', string>;
  spacing: Record<'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'xxxl', number>;
  radius: Record<'sm' | 'md' | 'lg' | 'xl' | 'full', number>;
  /** Text styles by variant (font family, size, line height). */
  typography: Record<TextVariant, Record<string, unknown>>;
  /** Timetable colour pair for a palette index. */
  courseColor(index: number): { fill: string; ink: string };
  /** Glass material: fill, hairline edge colour, and the top-edge light (CSS backgroundImage for a 1px line). */
  glass: { surface: string; rim: string; sheen: string };
  /** Layout width available to content (max-width aware). */
  contentWidth: number;
}

/** The app's languages: Simplified Chinese (source) and English. */
export type AppLocale = 'zh-Hans' | 'en';

export interface HostUI {
  components: HostComponents;
  /** Haptic feedback that respects the user's settings. */
  haptics: { tap(): void; select(): void; success(): void; warning(): void };
  /** Navigate to an app route or another plugin screen (`/p/<plugin>/<screen>`). */
  navigate(href: string): void;
  back(): void;
  /** Re-render when the host's data stores change (jobs, todos, widgets, timetable). */
  useStoreVersion(): number;
  /** Current theme tokens (re-renders on theme change). */
  useTheme(): HostTheme;
  /** Current time, refreshed every `intervalMs`. */
  useNow(intervalMs?: number): Date;
  /** Close a modal screen (falls back to the given route when opened from a deep link). */
  dismiss(fallback?: string): void;
  /** Ask the agent: switch to chat and send a message. */
  ask(text: string): void;
  /** Live result of a read-only tool (see LiveData). `ttlMinutes` defaults to 5. */
  useToolData<T = unknown>(tool: string, args?: Record<string, unknown>, opts?: { ttlMinutes?: number; path?: string }): LiveData<T>;
  /** An AI-built widget's spec state with every binding filled in (see LiveData). */
  useWidgetData(widget: Pick<Widget, 'spec' | 'bindings'>): LiveData<Record<string, unknown>>;
  /** Live values for several bindings at once. */
  useBindings(bindings: Binding[]): LiveData<unknown[]>;
  /** Force-refresh every live query on screen (pull-to-refresh); resolves when all settle. */
  refreshAll(): Promise<void>;
  /** "刚刚" / "3 分钟前" / "昨天 08:00" for a past timestamp. */
  formatAgo(ms: number, now?: number): string;
  /** While the calling screen is mounted: block screenshots/recording; `brightness` raises it for scanners. */
  useSecureDisplay(opts?: { brightness?: boolean }): void;
  /** App language (re-renders on change). Plugins keep their own strings per locale. */
  useLocale(): AppLocale;
  /** Copy text to the system clipboard; undefined when this build has no clipboard module. */
  clipboard?: { setString(text: string): Promise<void> };
  /**
   * Open the system share sheet (WeChat, QQ, copy…) with a share link and an optional message.
   * The plugin never sees the URL. Undefined until the host supports cloud channels.
   */
  shareLink?(link: SecretLink, opts?: { message?: string }): Promise<void>;
}

export interface PluginScreenProps {
  host: HostUI;
  services: HostServices;
  /** This plugin's store. */
  kv: KV;
  /** Run one of the app's tools as the user (same validation and permissions as the agent). */
  invoke(toolId: string, input?: Record<string, unknown>): Promise<unknown>;
  params: Record<string, string | undefined>;
  /** This plugin's cloud client (plugins that declare `PluginDef.cloud`). */
  cloud?: PluginCloud;
}

export interface PluginWidgetProps {
  host: HostUI;
  services: HostServices;
  kv: KV;
  invoke(toolId: string, input?: Record<string, unknown>): Promise<unknown>;
  size: WidgetSize;
  /** Agent/user-chosen options, validated by `configSchema`. */
  config: Record<string, unknown>;
  /** This plugin's cloud client (plugins that declare `PluginDef.cloud`). */
  cloud?: PluginCloud;
}

/**
 * A native dashboard widget a plugin ships. The agent places it with `dashboard.addPluginWidget`
 * (or the user from the dashboard's widget gallery). Load data with `host.useToolData` so refresh
 * behaves like every other widget; the card chrome (title, background) is drawn by the dashboard.
 */
export interface WidgetContribution {
  title: string;
  /** What it shows; the agent reads this to pick widgets. */
  description: string;
  sizes?: WidgetSize[];
  defaultSize?: WidgetSize;
  configSchema?: z.ZodType<Record<string, unknown>>;
  component: ComponentType<PluginWidgetProps>;
}

export interface ScreenContribution {
  title: string;
  component: ComponentType<PluginScreenProps>;
  /** 'modal' screens open at `/m/<plugin>/<screen>` (forms); default 'push' at `/p/…`. */
  presentation?: 'push' | 'modal';
}

/** The harness has fixed tab slots; Chat and Settings are the harness's own. */
export type TabSlot = 'dashboard' | 'schedule';

export interface TabContribution {
  slot: TabSlot;
  /** Key of a screen in `contributes.screens`, rendered as the tab's content. */
  screen: string;
}

export interface SettingsContribution {
  /** Key of a screen in `contributes.screens`. */
  screen: string;
  title: string;
  subtitle?: string;
  icon?: string;
}

export interface Contributions {
  /** Screens the harness mounts at `/p/<plugin>/<screen>`. */
  screens?: Record<string, ScreenContribution>;
  /** Rows the harness lists in Settings, opening one of the plugin's screens. */
  settings?: SettingsContribution[];
  /** Fill one of the harness's tab slots with a screen. */
  tabs?: TabContribution[];
  /** Native dashboard widgets, keyed by id. */
  widgets?: Record<string, WidgetContribution>;
  /** Slash commands for the chat composer, keyed by name (lowercase, /^[a-z][a-z0-9-]*$/). */
  commands?: Record<string, CommandContribution>;
}

/**
 * A `/command` a plugin adds to the composer (docs/AGENT-HARNESS.md §3). Either a prompt
 * template sent to the agent as the user's message, or a local action that never reaches the
 * model. Names are namespaced by the harness only on collision (`/plugin:name`).
 */
export type CommandContribution = {
  /** One line, shown in the / menu. */
  description: string;
  /** Extra names matched by the menu, e.g. Chinese ('余额'). */
  aliases?: string[];
  /** Placeholder for the argument, e.g. '关键词'. Present = the command takes input. */
  argHint?: string;
} & (
  | {
      /** Sent as the user message; `{{input}}` is replaced by what follows the command. */
      prompt: string;
    }
  | {
      /** Runs locally; the returned text is shown as a notice in the chat (never sent to the model). */
      /** `locale`: the app language, for the returned notice text. */
      run: (input: string, ctx: { services: HostServices; navigate: (href: string) => void; locale: AppLocale }) => Promise<string | void> | string | void;
    }
);
