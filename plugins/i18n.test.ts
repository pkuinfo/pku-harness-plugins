/**
 * Every bundled plugin is bilingual (docs/AGENT-HARNESS.md §8): each user-facing manifest
 * string has an English overlay in `i18n.en`, and every per-plugin string table (`src/strings.ts`)
 * reads as English in `en`. React Native is mocked so screens/widgets can be imported under bun.
 */
import { describe, expect, mock, test } from 'bun:test';
import { Glob } from 'bun';

const anything: any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : anything), apply: () => anything, construct: () => anything });
mock.module('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {}, flatten: (s: unknown) => s },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Animated: anything, Easing: anything, AccessibilityInfo: anything, Alert: anything, AppState: anything, RefreshControl: anything, TextInput: anything, View: anything,
}));

const { builtinPlugins } = await import('./index');

const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;
/** Problems with one English string: CJK outside a parenthesised gloss or quotes, straight apostrophes, "!". Tables may hold "" (nothing shown in English). */
function problems(s: string, allowEmpty = false): string[] {
  const out: string[] = [];
  if (!allowEmpty && !s.trim()) out.push('empty');
  if (CJK.test(s.replace(/[(（][^)）]*[)）]/g, '').replace(/"[^"]*"/g, ''))) out.push('CJK outside a gloss');
  if (/[A-Za-z]'[A-Za-z]/.test(s)) out.push('straight apostrophe (use ’)');
  if (/!(?!=)/.test(s)) out.push('exclamation mark');
  return out;
}

describe('plugin manifests have English', () => {
  for (const p of builtinPlugins) {
    test(p.id, () => {
      const en = p.i18n?.en;
      const missing: string[] = [];
      const bad: string[] = [];
      const check = (path: string, zh: string | undefined, value: string | undefined) => {
        if (zh == null) return;
        if (value == null) return void missing.push(path);
        for (const pr of problems(value)) bad.push(`${path}: ${pr} — ${JSON.stringify(value)}`);
      };
      check('name', p.name, en?.name);
      check('description', p.description, en?.description);
      for (const [k, t] of Object.entries(p.tools)) check(`tools.${k}.title`, t.title, en?.tools?.[k]?.title);
      for (const [k, d] of Object.entries(p.dataSources ?? {})) check(`dataSources.${k}.title`, d.title, en?.dataSources?.[k]?.title);
      const c = p.contributes ?? {};
      for (const [k, w] of Object.entries(c.widgets ?? {})) {
        check(`widgets.${k}.title`, w.title, en?.widgets?.[k]?.title);
        check(`widgets.${k}.description`, w.description, en?.widgets?.[k]?.description);
      }
      for (const [k, s] of Object.entries(c.screens ?? {})) check(`screens.${k}.title`, s.title, en?.screens?.[k]?.title);
      for (const s of c.settings ?? []) {
        check(`settings.${s.screen}.title`, s.title, en?.settings?.[s.screen]?.title);
        check(`settings.${s.screen}.subtitle`, s.subtitle, en?.settings?.[s.screen]?.subtitle);
      }
      for (const [k, cmd] of Object.entries(c.commands ?? {})) {
        const o = en?.commands?.[k];
        check(`commands.${k}.description`, cmd.description, o?.description);
        check(`commands.${k}.argHint`, cmd.argHint, o?.argHint);
        for (const a of o?.aliases ?? []) {
          if (!/^\S+$/.test(a) || CJK.test(a)) bad.push(`commands.${k}.aliases: ${JSON.stringify(a)}`);
        }
      }
      // Overlay keys must point at things that exist (catches typos and renamed tools).
      const known = { tools: p.tools, widgets: c.widgets, screens: c.screens, commands: c.commands, dataSources: p.dataSources, settings: Object.fromEntries((c.settings ?? []).map((s) => [s.screen, s])) };
      for (const [group, entries] of Object.entries(known)) {
        for (const key of Object.keys((en as Record<string, Record<string, unknown> | undefined>)?.[group] ?? {})) {
          if (!(entries && key in entries)) bad.push(`${group}.${key}: no such ${group.replace(/s$/, '')}`);
        }
      }
      expect(missing).toEqual([]);
      expect(bad).toEqual([]);
    });
  }
});

/** Every string reachable in a table; functions are called with sample arguments. */
function* strings(value: unknown, path: string): Generator<[string, string]> {
  if (typeof value === 'string') yield [path, value];
  else if (typeof value === 'function') {
    for (const args of [[2, 2, 2], ['x', 'x', 'x'], [{}]]) {
      try {
        const r = (value as (...a: unknown[]) => unknown)(...args);
        if (typeof r === 'string') {
          yield [path, r];
          return;
        }
      } catch {
        // try the next sample
      }
    }
  } else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, `${path}.${k}`);
}

const keys = (o: object) => Object.keys(o).sort();

describe('plugin string tables', () => {
  const files = [...new Glob('*/src/**/strings.ts').scanSync(import.meta.dir)];
  test('every plugin with screens or widgets has one', () => {
    const withUI = builtinPlugins.filter((p) => Object.keys(p.contributes?.screens ?? {}).length || Object.keys(p.contributes?.widgets ?? {}).length).map((p) => p.id);
    const dirs = new Set(files.map((f) => f.split('/')[0]));
    expect(withUI.filter((id) => !dirs.has(id))).toEqual([]);
  });
  for (const file of files) {
    test(file, async () => {
      const mod = (await import(`./${file}`)) as Record<string, unknown>;
      const tables = Object.values(mod).filter((v): v is { 'zh-Hans': object; en: object } => !!v && typeof v === 'object' && 'zh-Hans' in v && 'en' in v);
      expect(tables.length).toBeGreaterThan(0);
      const bad: string[] = [];
      for (const t of tables) {
        expect(keys(t.en)).toEqual(keys(t['zh-Hans']));
        for (const [path, s] of strings(t.en, 'en')) for (const pr of problems(s, true)) bad.push(`${path}: ${pr} — ${JSON.stringify(s)}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
