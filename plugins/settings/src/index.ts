import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

/**
 * The agent's entry point to every setting: the host's own (theme, language, time zone,
 * haptics, AI model, each plugin's switch and permissions) and the ones plugins declare
 * (Copilot's apps and screenshots, …), all in one registry (HostServices.settings). The Settings
 * screens write the same stores, so a change from either place shows in both.
 */

const value = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const inputs = {
  list: z.object({
    query: z.string().max(80).optional().describe('only settings whose key, title or group contains this (case-insensitive)'),
  }),
  change: z.object({
    changes: z
      .array(z.object({ key: z.string().min(1).describe('setting key from settings__list'), value: value.describe('new value: one of its options, true/false, text, or a list') }))
      .min(1)
      .max(20),
  }),
  open: z.object({ key: z.string().min(1).describe('setting key from settings__list') }),
};

export const settingsPlugin = definePlugin({
  id: 'settings',
  name: '设置',
  description: '查看和修改 App 的全部设置：外观、语言、时区、AI 模型，以及每个插件的开关、权限和它自己的设置。',
  version: '0.1.0',
  i18n: {
    en: {
      name: 'Settings',
      description: 'Reads and changes every app setting: appearance, language, time zone, AI model, and each plugin’s switch, permissions and own settings.',
      tools: {
        list: { title: 'View settings' },
        change: { title: 'Change settings' },
        open: { title: 'Open a settings screen' },
      },
    },
  },
  icon: 'settings',
  core: true,
  scopes: [],
  instructions: `所有设置都在一个地方，键名形如 app.theme、app.language、plugin.<插件>.enabled、plugin.<插件>.permission.<read|write|money|public>、copilot.apps。
- 用户要改任何设置（外观、语言、时区、AI 模型、某个插件的开关或权限、Copilot 能用哪些 App……），先 settings__list（可带 query）找到键和可选值，再 settings__change 一次改完，改完用一句话说明改了什么（前→后）。
- uiOnly 的项（密码、API Key、校园账号、系统权限）不能由你修改：用 settings__open 打开对应页面，请用户自己操作。
- 只改用户要求的项，不顺手改别的。
All settings live in one registry: find keys with settings__list, change them with settings__change (report before → after), and open the screen with settings__open for uiOnly items (secrets, accounts, system permissions).`,
  tools: {
    list: defineTool({
      title: '查看设置',
      description:
        'Every app and plugin setting: { key, group, title, kind, options?, value, uiOnly?, screen? }. Pass `query` to narrow it (matches key, title or group). Keys: app.* (theme, language, timezone, haptics), ai.* (model), plugin.<id>.enabled and plugin.<id>.permission.<effect> (auto | ask | off), and <plugin>.<name> for a plugin’s own settings.',
      input: inputs.list,
      effect: 'read',
      execute: async ({ query }, ctx) => {
        const all = await ctx.services.settings.list();
        const q = query?.trim().toLowerCase();
        return { settings: q ? all.filter((s) => `${s.key} ${s.title} ${s.group}`.toLowerCase().includes(q)) : all };
      },
    }),
    change: defineTool({
      title: '修改设置',
      description:
        'Change one or more settings by key (from settings__list). Values must match the setting: an option value for choice, true/false for boolean, text, or a list of strings. uiOnly settings are refused (open their screen instead). Returns [{ key, before, after }].',
      input: inputs.change,
      effect: 'write',
      execute: async ({ changes }, ctx) => ({ changed: await ctx.services.settings.change(changes) }),
    }),
    open: defineTool({
      title: '打开设置页面',
      description: 'Show the user the screen of a setting (from settings__list), for uiOnly settings or when the user wants to look.',
      input: inputs.open,
      effect: 'read',
      execute: async ({ key }, ctx) => {
        ctx.services.settings.open(key);
        return { opened: key };
      },
    }),
  },
});
