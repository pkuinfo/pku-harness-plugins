import type { ComponentType, ReactNode } from 'react';

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
  /** Render a generative-UI spec with the host catalog. */
  GenUI: ComponentType<{ spec: Record<string, unknown>; onSubmit?: (form: Record<string, unknown>, label?: string) => void }>;
  /** Vertical list sortable by dragging a handle; rows are rendered by the plugin. */
  SortableList: ComponentType<{ ids: string[]; rowHeight: number; onReorder: (ids: string[]) => void; renderRow: (id: string, handle: ReactNode) => ReactNode }>;
}

/** Design tokens and helpers for plugin layouts (styles are plain React Native styles). */
export interface HostTheme {
  name: 'light' | 'dark';
  colors: Record<'bg' | 'surface' | 'surface2' | 'surface3' | 'border' | 'text' | 'textMuted' | 'textFaint' | 'accent' | 'accentMuted' | 'onAccent' | 'up' | 'upMuted' | 'down' | 'downMuted' | 'warn' | 'warnMuted' | 'info' | 'infoMuted', string>;
  spacing: Record<'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'xxxl', number>;
  radius: Record<'sm' | 'md' | 'lg' | 'xl' | 'full', number>;
  /** Text styles by variant (font family, size, line height). */
  typography: Record<TextVariant, Record<string, unknown>>;
  /** Timetable colour pair for a palette index. */
  courseColor(index: number): { fill: string; ink: string };
  /** Translucent "glass" surface: background, rim and sheen gradient for CSS backgroundImage. */
  glass: { surface: string; rim: string; sheen: string };
  /** Layout width available to content (max-width aware). */
  contentWidth: number;
}

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
}

export interface PluginScreenProps {
  host: HostUI;
  services: HostServices;
  /** This plugin's store. */
  kv: KV;
  /** Run one of the app's tools as the user (same validation and permissions as the agent). */
  invoke(toolId: string, input?: Record<string, unknown>): Promise<unknown>;
  params: Record<string, string | undefined>;
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
}
