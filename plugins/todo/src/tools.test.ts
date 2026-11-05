import { describe, expect, test } from 'bun:test';
import { todoRepeat } from '@pku-harness/sdk';

import { repeatInput, resolveDue, toRule } from './tools';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const now = at(2026, 11, 5, 12); // Thursday

describe('repeat input', () => {
  test('interval defaults to 1; a date-only until means the end of that day', () => {
    const r = repeatInput.parse({ unit: 'week', weekdays: [1], until: '2026-12-31' })!;
    expect(toRule(r)).toEqual({ unit: 'week', interval: 1, weekdays: [1], count: undefined, until: at(2026, 12, 31, 23, 59) });
  });
  test('weekdays are ignored for daily repeats', () => {
    expect(toRule(repeatInput.parse({ unit: 'day', interval: 3, weekdays: [2] })!).weekdays).toBeUndefined();
  });
});

describe('resolveDue', () => {
  test('plain to-do: due parsed, repeat untouched', () => {
    expect(resolveDue(undefined, '2026-11-06 18:00', undefined, now)).toEqual({ dueAt: at(2026, 11, 6, 18), repeat: undefined });
    expect(resolveDue(undefined, undefined, undefined, now)).toEqual({ dueAt: null, repeat: undefined });
  });

  test('"每周一交周报" with a due time: anchored on it', () => {
    const r = resolveDue(undefined, '2026-11-09 18:00', { unit: 'week', interval: 1, weekdays: [1] }, now);
    expect(r.dueAt).toBe(at(2026, 11, 9, 18));
    expect(r.repeat).toEqual(todoRepeat({ unit: 'week', interval: 1, weekdays: [1] }, at(2026, 11, 9, 18)));
  });

  test('repeat without a due time: next matching day at 09:00', () => {
    expect(resolveDue(undefined, undefined, { unit: 'week', interval: 1, weekdays: [1] }, now).dueAt).toBe(at(2026, 11, 9, 9));
  });

  test('moving the due time re-anchors an existing repeat; clearing it stops repeating', () => {
    const cur = { dueAt: at(2026, 11, 9, 18), repeat: todoRepeat({ unit: 'week', interval: 1, weekdays: [1] }, at(2026, 11, 9, 18)) };
    const moved = resolveDue(cur, '2026-11-09 20:00', undefined, now);
    expect(moved.repeat?.times).toEqual(['20:00']);
    expect(moved.repeat?.weekdays).toEqual([1]);
    expect(resolveDue(cur, null, undefined, now)).toEqual({ dueAt: null, repeat: null });
    expect(resolveDue(cur, undefined, undefined, now)).toEqual({ dueAt: cur.dueAt, repeat: undefined });
    expect(resolveDue(cur, undefined, null, now)).toEqual({ dueAt: cur.dueAt, repeat: null });
  });
});
