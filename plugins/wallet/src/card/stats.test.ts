/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { unwrap } from '../../../shared/campus-card';
import { currentMonth, monthRange, statsUrls, summarizeMonth } from './stats';

const res = (body: unknown, status = 200) => ({ status, url: 'https://bdcard.pku.edu.cn/x', headers: {}, body: JSON.stringify(body) });

describe('monthRange', () => {
  test('month lengths incl. leap February', () => {
    expect(monthRange('2026-04')).toEqual({ month: '2026-04', from: '2026-04-01', to: '2026-04-30' });
    expect(monthRange('2028-02').to).toBe('2028-02-29');
    expect(monthRange('2026-02').to).toBe('2026-02-28');
    expect(monthRange('2026-12').to).toBe('2026-12-31');
  });
  test('rejects bad input', () => {
    expect(() => monthRange('2026-13')).toThrow('月份格式错误');
    expect(() => monthRange('2026/04')).toThrow('月份格式错误');
  });
  test('currentMonth pads', () => {
    expect(currentMonth(new Date(2026, 0, 5))).toBe('2026-01');
  });
});

describe('statsUrls', () => {
  test('matches pkucli api.rs', () => {
    expect(statsUrls('2026-04')).toEqual({
      count: '/berserker-search/statistics/turnover/count?timeFrom=2026-04-01&timeTo=2026-04-30&synAccessSource=h5',
      categories: '/berserker-search/statistics/turnover?type=2&timeFrom=2026-04-01&timeTo=2026-04-30&synAccessSource=h5',
      daily: '/berserker-search/statistics/turnover/sum/user?dateStr=2026-04&dateType=month&statisticsDateStr=day&type=2&synAccessSource=h5',
    });
  });
});

describe('stats envelopes', () => {
  test('count / category / daily shapes unwrap', () => {
    expect(unwrap(res({ code: 200, success: true, data: { income: 50000, expenses: 123456.0 } }))).toEqual({ income: 50000, expenses: 123456 });
    expect(unwrap(res({ code: 200, success: true, data: [{ turnoverType: '餐费', amount: 100 }] }))).toEqual([{ turnoverType: '餐费', amount: 100 }]);
    expect(unwrap(res({ code: 200, success: true, data: { '2026-04-01': 1200 } }))).toEqual({ '2026-04-01': 1200 });
  });
  test('401 is a session error', () => {
    expect(() => unwrap(res({ code: 401, message: 'token expired' }))).toThrow('登录已失效');
  });
});

describe('summarizeMonth', () => {
  test('fen → yuan, sorted categories, active days only', () => {
    const s = summarizeMonth(
      '2026-04',
      { income: 50000, expenses: 60000 },
      [
        { turnoverType: '超市', amount: 15000 },
        { turnoverType: '餐费', amount: 45000 },
        { turnoverType: null, amount: 0 },
      ],
      { '2026-04-03': 2050, '2026-04-01': 1500, '2026-04-02': 0 },
    );
    expect(s).toEqual({
      month: '2026-04',
      income: 500,
      expenses: 600,
      net: -100,
      categories: [
        { category: '餐费', amount: 450, share: 0.75 },
        { category: '超市', amount: 150, share: 0.25 },
      ],
      daily: [
        { date: '2026-04-01', amount: 15 },
        { date: '2026-04-03', amount: 20.5 },
      ],
      activeDays: 2,
      averagePerActiveDay: 17.75,
      biggestDay: { date: '2026-04-03', amount: 20.5 },
    });
  });
  test('empty month', () => {
    const s = summarizeMonth('2026-05', { income: 0, expenses: 0 }, [{ amount: 300 }], null);
    expect(s.categories).toEqual([{ category: '其他', amount: 3, share: null }]);
    expect(s.daily).toEqual([]);
    expect(s.averagePerActiveDay).toBeNull();
    expect(s.biggestDay).toBeNull();
  });
});
