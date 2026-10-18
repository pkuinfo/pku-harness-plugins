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
}
