import { describe, expect, test } from 'bun:test';

import { addMonths, bucketKeys, dayKey, formatMoney, monthBounds, monthKey, monthsBetween, parseWhen, previousRange, resolvePeriod, round2, sumYuan, toFen } from './time';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('money in fen', () => {
  test('no float drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumYuan([0.1, 0.2])).toBe(0.3);
    expect(sumYuan([19.99, 0.01, 1.005])).toBe(21.01);
    expect(toFen(1.005)).toBe(101);
    expect(toFen(-2.5)).toBe(-250);
    expect(round2(18.004)).toBe(18);
  });
  test('formatMoney groups thousands', () => {
    expect(formatMoney(1234.5)).toBe('1,234.50');
    expect(formatMoney(-18)).toBe('-18.00');
    expect(formatMoney(1234567.891, 0)).toBe('1,234,568');
  });
});

describe('local months and days', () => {
  test('keys use local time, late evening stays on its day', () => {
    expect(monthKey(at(2026, 11, 30, 23, 59))).toBe('2026-11');
    expect(dayKey(at(2026, 12, 31, 23, 30))).toBe('2026-12-31');
    expect(monthKey(at(2027, 1, 1, 0, 0))).toBe('2027-01');
  });
  test('month bounds, incl. leap February', () => {
    expect(monthBounds('2028-02')).toEqual({ start: at(2028, 2, 1), end: at(2028, 3, 1) });
    expect(monthBounds('2026-12').end).toBe(at(2027, 1, 1));
    expect(() => monthBounds('2026-13')).toThrow('月份格式错误');
  });
  test('month arithmetic across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('parseWhen', () => {
  const now = at(2026, 11, 5, 9, 30);
  test('today without time = now, another day = noon', () => {
    expect(parseWhen('2026-11-05', now)).toBe(now);
    expect(parseWhen('2026-11-04', now)).toBe(at(2026, 11, 4, 12));
    expect(parseWhen('2026-11-04 08:05', now)).toBe(at(2026, 11, 4, 8, 5));
  });
  test('rejects nonsense', () => {
    expect(() => parseWhen('2026-02-30', now)).toThrow('没有这一天');
    expect(() => parseWhen('2026-11-04 25:00', now)).toThrow('时间格式错误');
    expect(() => parseWhen('yesterday', now)).toThrow('时间格式错误');
  });
});

describe('periods', () => {
  const now = at(2026, 11, 5, 9, 30); // a Thursday
  test('named periods', () => {
    expect(resolvePeriod({}, now)).toEqual({ start: at(2026, 11, 1), end: at(2026, 12, 1), label: '2026-11', unit: 'day' });
    expect(resolvePeriod({ period: 'last-month' }, now).label).toBe('2026-10');
    expect(resolvePeriod({ period: 'year' }, now)).toEqual({ start: at(2026, 1, 1), end: at(2027, 1, 1), label: '2026', unit: 'month' });
    expect(resolvePeriod({ period: 'last-year' }, now).label).toBe('2025');
    expect(resolvePeriod({ period: 'week' }, now).start).toBe(at(2026, 11, 2)); // Monday
    expect(resolvePeriod({ period: 'today' }, now)).toMatchObject({ start: at(2026, 11, 5), end: at(2026, 11, 6) });
    expect(resolvePeriod({ month: '2026-02' }, now).label).toBe('2026-02');
  });
  test('custom ranges are inclusive and pick their unit', () => {
    expect(resolvePeriod({ from: '2026-11-03', to: '2026-11-01' }, now)).toEqual({ start: at(2026, 11, 1), end: at(2026, 11, 4), label: '2026-11-01~2026-11-03', unit: 'day' });
    expect(resolvePeriod({ from: '2026-01-01', to: '2026-06-30' }, now).unit).toBe('month');
  });
  test('previous period by calendar', () => {
    expect(previousRange(resolvePeriod({ month: '2026-03' }, now))).toMatchObject({ start: at(2026, 2, 1), end: at(2026, 3, 1), label: '2026-02' });
    expect(previousRange(resolvePeriod({ period: 'year' }, now))).toMatchObject({ start: at(2025, 1, 1), label: '2025' });
    expect(previousRange(resolvePeriod({ from: '2026-11-04', to: '2026-11-05' }, now))).toMatchObject({ start: at(2026, 11, 2), end: at(2026, 11, 4) });
  });
  test('bucket keys fill every day or month', () => {
    expect(bucketKeys(resolvePeriod({ month: '2026-02' }, now))).toHaveLength(28);
    expect(bucketKeys(resolvePeriod({ period: 'year' }, now))[11]).toBe('2026-12');
  });
});
