import { describe, expect, test } from 'bun:test';
import type { SettingInfo, SettingValue, SettingsService } from '@pku-harness/sdk';

import { inputs, settingsPlugin } from './index';

const ALL: SettingInfo[] = [
  { key: 'app.theme', group: 'App', title: 'Appearance', kind: 'choice', options: [{ value: 'dark', label: 'Dark' }], value: 'system' },
  { key: 'copilot.apps', group: 'Copilot', title: 'Apps Copilot may use', kind: 'list', value: ['com.tencent.mm'] },
  { key: 'ai.apiKey', group: 'AI', title: 'AI API key', kind: 'text', value: null, uiOnly: true, screen: '/ai-settings' },
];

function fake() {
  const calls: unknown[][] = [];
  const settings: SettingsService = {
    list: async () => ALL,
    change: async (changes: { key: string; value: SettingValue }[]) => {
      calls.push(['change', changes]);
      return changes.map((c) => ({ key: c.key, before: ALL.find((s) => s.key === c.key)?.value ?? null, after: c.value }));
    },
    open: (key) => void calls.push(['open', key]),
  };
  return { calls, services: { settings } };
}

const run = (services: object, tool: string, input: unknown) => {
  const t = settingsPlugin.tools[tool]!;
  return t.execute(t.input.parse(input), { pluginId: 'settings', actor: 'agent', kv: {}, services } as never) as Promise<any>;
};

describe('settings plugin', () => {
  test('manifest: core; list/open read, change write and not user-only', () => {
    expect(settingsPlugin).toMatchObject({ id: 'settings', core: true });
    const t = settingsPlugin.tools;
    expect(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, [v.effect, !!v.userOnly, !!v.alwaysAsk]]))).toEqual({
      list: ['read', false, false],
      change: ['write', false, false],
      open: ['read', false, false],
    });
  });

  test('list returns everything, or filters by key, title or group', async () => {
    const { services } = fake();
    expect((await run(services, 'list', {})).settings).toHaveLength(3);
    expect((await run(services, 'list', { query: 'COPILOT' })).settings.map((s: SettingInfo) => s.key)).toEqual(['copilot.apps']);
    expect((await run(services, 'list', { query: 'appearance' })).settings.map((s: SettingInfo) => s.key)).toEqual(['app.theme']);
  });

  test('change passes every change through and reports before → after', async () => {
    const { calls, services } = fake();
    const out = await run(services, 'change', { changes: [{ key: 'app.theme', value: 'dark' }, { key: 'copilot.apps', value: ['com.tencent.mm', 'com.taobao.taobao'] }] });
    expect(out.changed).toEqual([
      { key: 'app.theme', before: 'system', after: 'dark' },
      { key: 'copilot.apps', before: ['com.tencent.mm'], after: ['com.tencent.mm', 'com.taobao.taobao'] },
    ]);
    expect(calls).toHaveLength(1);
  });

  test('open hands the key to the host', async () => {
    const { calls, services } = fake();
    expect(await run(services, 'open', { key: 'ai.apiKey' })).toEqual({ opened: 'ai.apiKey' });
    expect(calls).toEqual([['open', 'ai.apiKey']]);
  });

  test('input validation', () => {
    expect(inputs.change.safeParse({ changes: [] }).success).toBe(false);
    expect(inputs.change.safeParse({ changes: [{ key: '', value: true }] }).success).toBe(false);
    expect(inputs.change.safeParse({ changes: [{ key: 'app.haptics', value: { on: true } }] }).success).toBe(false);
    expect(inputs.change.safeParse({ changes: [{ key: 'app.haptics', value: false }] }).success).toBe(true);
  });
});
