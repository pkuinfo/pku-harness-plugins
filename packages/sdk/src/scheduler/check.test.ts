import { describe, expect, test } from 'bun:test';

import { evaluate, fillTemplate, getPath } from './check';

describe('check conditions', () => {
  test('numeric comparisons accept numeric strings', () => {
    expect(evaluate({ path: '', op: '<', value: 100 }, 86.5)).toBe(true);
    expect(evaluate({ path: '', op: '<', value: 100 }, '120')).toBe(false);
    expect(evaluate({ path: '', op: '>=', value: 100 }, 100)).toBe(true);
    expect(evaluate({ path: '', op: '<', value: 100 }, null)).toBe(false);
  });

  test('equality and change detection', () => {
    expect(evaluate({ path: '', op: '==', value: 3 }, '3')).toBe(true);
    expect(evaluate({ path: '', op: '!=', value: 'ok' }, 'ok')).toBe(false);
    expect(evaluate({ path: '', op: 'changed' }, 5, undefined)).toBe(false);
    expect(evaluate({ path: '', op: 'changed' }, 5, 4)).toBe(true);
    expect(evaluate({ path: '', op: 'changed' }, { a: 1 }, { a: 1 })).toBe(false);
  });

  test('paths and templates', () => {
    expect(getPath({ data: { balance: 42 } }, 'data.balance')).toBe(42);
    expect(getPath({ items: [{ v: 1 }] }, 'items.0.v')).toBe(1);
    expect(getPath({ a: 1 }, 'b.c')).toBeUndefined();
    expect(fillTemplate('余额 ¥{value}，记得充值', 86.456)).toBe('余额 ¥86.46，记得充值');
  });
});
