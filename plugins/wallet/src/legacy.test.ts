/**
 * The wallet replaced campus-card, netfee and utilities: every id users may have stored (jobs,
 * dashboard widgets, settings) must map to something that exists. React Native is mocked so the
 * screens and widgets can be imported under bun.
 */
import { describe, expect, mock, test } from 'bun:test';

const anything: any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : anything), apply: () => anything, construct: () => anything });
// Same mock as ../../i18n.test.ts (bun shares module mocks across test files).
mock.module('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {}, flatten: (s: unknown) => s },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Animated: anything, Easing: anything, AccessibilityInfo: anything, Alert: anything, AppState: anything, RefreshControl: anything, Share: anything, TextInput: anything, View: anything,
}));

const { walletPlugin } = await import('./index');

/** Every tool the three old plugins had (plugins repo before 2026-10-22). */
const OLD_TOOLS = [
  'campus-card.getBalance',
  'campus-card.setDigitalCard',
  'campus-card.recharge',
  'campus-card.getMonthlyStats',
  'campus-card.listTransactions',
  'netfee.getStatus',
  'utilities.bathCard',
  'utilities.rechargeBath',
  'utilities.payProjects',
  'utilities.openPayCenter',
];

describe('wallet legacy ids', () => {
  const legacy = walletPlugin.legacy!;
  test('replaces the three plugins', () => {
    expect(legacy.pluginIds).toEqual(['campus-card', 'netfee', 'utilities']);
  });
  test('every old tool maps to a wallet tool', () => {
    expect(Object.keys(legacy.tools ?? {}).sort()).toEqual([...OLD_TOOLS].sort());
    for (const name of Object.values(legacy.tools ?? {})) expect(walletPlugin.tools[name]).toBeDefined();
  });
  test('old tools keep their effect', () => {
    const effects: Record<string, string> = { 'campus-card.setDigitalCard': 'write', 'campus-card.recharge': 'money', 'utilities.rechargeBath': 'money', 'utilities.openPayCenter': 'write' };
    for (const [old, name] of Object.entries(legacy.tools ?? {})) expect(walletPlugin.tools[name].effect).toBe((effects[old] ?? 'read') as never);
  });
  test('every old widget maps to a wallet widget', () => {
    expect(Object.keys(legacy.widgets ?? {}).sort()).toEqual(['campus-card.balance', 'netfee.balance', 'utilities.bath']);
    for (const key of Object.values(legacy.widgets ?? {})) expect(walletPlugin.contributes?.widgets?.[key]).toBeDefined();
  });
  test('old screen routes (/m/campus-card/pay, /m/utilities/bath-recharge) still find their screen', () => {
    for (const key of ['pay', 'recharge', 'bath-recharge']) expect(walletPlugin.contributes?.screens?.[key]).toBeDefined();
  });
});
