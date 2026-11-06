import { describe, expect, test } from 'bun:test';

import { eachZone } from '@pku-harness/sdk/testing';

import { budgetStatus, byCategory, foldShares, groupByDay, series, totals } from './aggregate';
import { defaultSettings, type Entry } from './model';
import { resolvePeriod } from './time';

eachZone((wallAt) => {
  // Entries default to noon.
  const at = (y: number, m: number, d: number, h = 12) => wallAt(y, m, d, h);
  let n = 0;
  const e = (amount: number, category: string, when: number, type: Entry['type'] = 'expense'): Entry => ({ id: `e${n++}`, type, amount, category, at: when });

  const nov = [
    e(18, 'food', at(2026, 11, 1)),
    e(0.1, 'food', at(2026, 11, 1, 20)),
    e(0.2, 'transport', at(2026, 11, 2)),
    e(100, 'shopping', at(2026, 11, 3)),
    e(1500, 'allowance', at(2026, 11, 1), 'income'),
    e(5, 'gone-category', at(2026, 11, 3)),
  ];

  describe('totals and categories', () => {
    test('sums in fen', () => {
      expect(totals(nov)).toEqual({ income: 1500, expense: 123.3, net: 1376.7, count: 6 });
    });
    test('by category: largest first, unknown ids fold into 其他, shares', () => {
      const cats = byCategory(nov, 'expense', defaultSettings().categories);
      expect(cats.map((c) => [c.category, c.name, c.amount, c.count])).toEqual([
        ['shopping', '购物', 100, 1],
        ['food', '餐饮', 18.1, 2],
        ['other', '其他', 5, 1],
        ['transport', '交通', 0.2, 1],
      ]);
      expect(cats[0].share).toBe(0.811);
      expect(byCategory(nov, 'income', defaultSettings().categories, 'en')[0]).toMatchObject({ name: 'Allowance', share: 1 });
    });
    test('fold the tail into one row', () => {
      const folded = foldShares(byCategory(nov, 'expense', defaultSettings().categories), 3, '其他');
      expect(folded.map((c) => [c.name, c.amount])).toEqual([
        ['购物', 100],
        ['餐饮', 18.1],
        ['其他', 5.2],
      ]);
    });
  });

  describe('series and grouping', () => {
    test('every day of the month, zero-filled', () => {
      const s = series(nov, resolvePeriod({ month: '2026-11' }, at(2026, 11, 5)));
      expect(s).toHaveLength(30);
      expect(s[0]).toEqual({ key: '2026-11-01', expense: 18.1, income: 1500 });
      expect(s[3]).toEqual({ key: '2026-11-04', expense: 0, income: 0 });
    });
    test('a year by month', () => {
      const s = series([...nov, e(9, 'food', at(2026, 1, 31, 23))], resolvePeriod({ period: 'year' }, at(2026, 11, 5)));
      expect(s.map((b) => b.expense)).toEqual([9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 123.3, 0]);
    });
    test('grouped by day, newest first', () => {
      const g = groupByDay(nov);
      expect(g.map((d) => d.day)).toEqual(['2026-11-03', '2026-11-02', '2026-11-01']);
      expect(g[2].entries[0].amount).toBe(0.1); // 20:00 before 12:00
      expect(g[2].totals.expense).toBe(18.1);
    });
  });

  // June: a 30-day month with no DST switch in any common zone, so the pace numbers are exact
  // under 'device' on any machine (November has a DST end in the US).
  describe('budget pace', () => {
    const settings = { ...defaultSettings(), budgets: { total: 1500, categories: { food: 600, fun: 0 } } };
    const spend = (amount: number, category = 'food') => e(amount, category, at(2026, 6, 2));
    test('on track: a third of the month gone, a fifth spent', () => {
      const s = budgetStatus([spend(300)], '2026-06', settings, at(2026, 6, 11, 0));
      expect(s.daysLeft).toBe(20);
      expect(s.lines.map((l) => l.scope)).toEqual(['total', 'food']); // a 0 budget is no budget
      const total = s.lines[0];
      expect(total).toMatchObject({ budget: 1500, spent: 300, remaining: 1200, percent: 0.2, elapsed: 0.333, status: 'ok', perDayLeft: 60 });
      expect(total.projected).toBe(900);
    });
    test('ahead of pace: spending faster than the month passes', () => {
      const s = budgetStatus([spend(400)], '2026-06', settings, at(2026, 6, 11, 0));
      expect(s.lines[1]).toMatchObject({ scope: 'food', percent: 0.667, status: 'ahead', projected: 1200 });
    });
    test('over budget, nothing left per day', () => {
      const s = budgetStatus([spend(700)], '2026-06', settings, at(2026, 6, 20));
      expect(s.lines[1]).toMatchObject({ status: 'over', remaining: -100, perDayLeft: 0 });
    });
    test('a finished month is complete, a future one not started', () => {
      const done = budgetStatus([spend(300)], '2026-06', settings, at(2026, 7, 3));
      expect(done.daysLeft).toBe(0);
      expect(done.lines[0]).toMatchObject({ elapsed: 1, projected: 300, status: 'ok', perDayLeft: 0 });
      expect(budgetStatus([], '2026-07', settings, at(2026, 6, 5))).toMatchObject({ daysLeft: 31 });
    });
  });

  describe('one clock for every view', () => {
    test('a late-evening entry lands on the same day in the month, the day series and a 30-day window', () => {
      const late = [e(33, 'food', at(2026, 11, 30, 23))];
      const month = series(late, resolvePeriod({ month: '2026-11' }, at(2026, 11, 30)));
      expect(month[29]).toEqual({ key: '2026-11-30', expense: 33, income: 0 });
      // The dashboard's "last 30 days": the 30 local days ending today.
      const end = at(2026, 12, 1, 0);
      const start = at(2026, 11, 1, 0);
      const window = series(late, { start, end, label: '2026-11-01', unit: 'day' });
      expect(window).toHaveLength(30);
      expect(totals(late.filter((x) => x.at >= start && x.at < end)).expense).toBe(33);
      expect(window[29]).toEqual({ key: '2026-11-30', expense: 33, income: 0 });
    });
  });
});
