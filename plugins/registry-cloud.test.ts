/**
 * The registry's `cloud` field (shown in the market before install) must match what each
 * bundled plugin declares in `PluginDef.cloud`, and must disclose what leaves the device
 * (docs/CLOUD.md §2.2). React Native is mocked so manifests can be imported under bun.
 */
import { describe, expect, mock, test } from 'bun:test';

import { cloudIssues, registry, type RegistryCloud } from '../registry/schema';

const anything: any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : anything), apply: () => anything, construct: () => anything });
mock.module('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {}, flatten: (s: unknown) => s },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Animated: anything, Easing: anything, AccessibilityInfo: anything, Alert: anything, AppState: anything, RefreshControl: anything, Share: anything, TextInput: anything, View: anything,
}));

const { builtinPlugins } = await import('./index');
const entries = registry.parse(await Bun.file(new URL('../registry/registry.json', import.meta.url)).json()).plugins;

const sample: RegistryCloud = { uses: ['channels'], e2e: true, disclosure: { zh: ['加密后的付款码经云服务转发'] } };

describe('cloud disclosure rules', () => {
  test('a complete entry passes', () => {
    expect(cloudIssues(sample)).toEqual([]);
    expect(cloudIssues({ uses: [], e2e: false, disclosure: { zh: [] } })).toEqual([]);
  });
  test('uses without zh disclosure fails', () => {
    expect(cloudIssues({ ...sample, disclosure: { zh: [] } }).join()).toContain('disclosure.zh');
  });
  test('blank lines, partial English, duplicates, plain-http backend fail', () => {
    expect(cloudIssues({ ...sample, disclosure: { zh: [' '] } })).toHaveLength(1);
    expect(cloudIssues({ ...sample, disclosure: { zh: ['a', 'b'], en: ['a'] } })).toHaveLength(1);
    expect(cloudIssues({ ...sample, uses: ['channels', 'channels'] })).toHaveLength(1);
    expect(cloudIssues({ ...sample, backend: { kind: 'external', url: 'http://x.org' } })).toHaveLength(1);
  });
});

describe('registry cloud matches PluginDef.cloud', () => {
  for (const p of builtinPlugins) {
    test(p.id, () => {
      const entry = entries.find((e) => e.id === p.id);
      if (!entry) return; // core plugins without a registry entry
      const def = p.cloud;
      if (!def) return void expect(entry.cloud).toBeUndefined();
      expect(entry.cloud).toBeDefined();
      expect([...entry.cloud!.uses].sort()).toEqual([...def.uses].sort());
      expect(entry.cloud!.e2e).toBe(def.e2e);
      expect(entry.cloud!.disclosure.zh).toEqual(def.disclosure.zh);
      expect(entry.cloud!.disclosure.en ?? []).toEqual(def.disclosure.en ?? []);
      expect(entry.cloud!.backend ?? { kind: 'provider' }).toEqual(def.backend ?? { kind: 'provider' });
      expect(cloudIssues(entry.cloud!)).toEqual([]);
      if (!def.optional) expect(p.requires ?? []).toContain('cloud');
      if (def.uses.length) expect(def.disclosure.zh.length).toBeGreaterThan(0);
    });
  }
});
