/**
 * Settings: one registry of everything the user can change in the app, read and written the
 * same way by the Settings screens and by the agent (the core `settings` plugin). The host lists
 * its own settings (theme, language, time zone, haptics, AI model, each plugin's switch and
 * permissions) together with the ones plugins declare in `PluginDef.preferences`, keyed
 * `<owner>.<name>`. Secrets and steps that need the user's hands are `uiOnly`: the agent can't
 * set them, only open their screen.
 */
import type { z } from 'zod';

import type { HostServices, KV } from './plugin';

export type SettingValue = string | number | boolean | string[];

export interface SettingInfo {
  /** `app.theme`, `plugin.copilot.enabled`, `copilot.apps`, … */
  key: string;
  /** Section it belongs to, for listing (`app`, `ai`, a plugin's name, …). */
  group: string;
  title: string;
  description?: string;
  /** `choice` takes one of `options`; `list` is a list of strings. */
  kind: 'choice' | 'boolean' | 'text' | 'list';
  options?: { value: string; label: string }[];
  value: SettingValue | null;
  /** A secret or a step that needs the user: never set by the agent; `screen` is where it lives. */
  uiOnly?: boolean;
  /** App route of the screen that shows this setting. */
  screen?: string;
}

export interface SettingChange {
  key: string;
  before: SettingValue | null;
  after: SettingValue | null;
}

export interface SettingsService {
  /** Every setting with its current value. */
  list(): Promise<SettingInfo[]>;
  /**
   * Apply changes in order. Unknown and `uiOnly` keys fail the call before anything changes;
   * each value is validated as it is applied, so a bad value stops the call there (earlier
   * changes stay).
   */
  change(changes: { key: string; value: SettingValue }[]): Promise<SettingChange[]>;
  /** Show the screen of a setting (for `uiOnly` ones, or when the user wants to look). */
  open(key: string): void;
}

/** What a plugin's preference gets to read and write its value with. */
export interface SettingContext {
  kv: KV;
  services: HostServices;
}

/** A setting a plugin declares (a preference) in `PluginDef.preferences`; the host lists it as `<plugin id>.<name>`. */
export interface PluginPreferenceDef<T extends SettingValue = SettingValue> {
  title: string;
  description?: string;
  kind: SettingInfo['kind'];
  options?: { value: string; label: string }[];
  /** Validates a new value (from the agent or a screen). */
  input: z.ZodType<T>;
  get(ctx: SettingContext): Promise<T>;
  set(ctx: SettingContext, value: T): Promise<void>;
  /** App route of the screen that shows it (defaults to the plugin's first screen). */
  screen?: string;
}

/** Type helper for `PluginDef.preferences` entries. */
export function definePreference<T extends SettingValue>(def: PluginPreferenceDef<T>): PluginPreferenceDef<T> {
  return def;
}
