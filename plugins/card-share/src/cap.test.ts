import { describe, expect, test } from 'bun:test';
import type { Turnover } from '../../shared/campus-card';

import { capLeft, evaluateCap, parseCardTime } from './cap';

// Synthetic turnover page shaped like /berserker-search/search/personal/turnover (fen, Beijing time).
const START = Date.UTC(2026, 9, 23, 4, 0, 0); // 12:00 Beijing
const page: Turnover[] = [
  { resume: '学五食堂', turnoverType: '餐费', tranamt: 1250, cardBalance: 8800, effectdateStr: '2026-10-23 12:14:02', icon: 'meal' },
  { resume: '校园卡充值', turnoverType: '充值', tranamt: 5000, cardBalance: 10050, effectdateStr: '2026-10-23 12:10:00', icon: 'recharge' },
  { resume: '农园超市', turnoverType: '超市', tranamt: 600, cardBalance: 5050, effectdateStr: '2026-10-23 12:05:30', icon: 'shop' },
  { resume: '早餐', turnoverType: '餐费', tranamt: 800, cardBalance: 5650, effectdateStr: '2026-10-23 08:01:00', icon: 'meal' },
  { resume: '退款', turnoverType: '退款', tranamt: 300, cardBalance: 6450, effectdateStr: '2026-10-23 12:20:00', icon: 'refund' },
];

describe('spend cap', () => {
  test('Beijing time parsing', () => {
    expect(parseCardTime('2026-10-23 12:00:00')).toBe(START);
    expect(parseCardTime('2026-10-23 12:00')).toBe(START);
    expect(parseCardTime('yesterday')).toBeUndefined();
    expect(parseCardTime(undefined)).toBeUndefined();
  });
  test('counts spending since the start, not income or earlier payments', () => {
    const st = evaluateCap(page, START, 50);
    expect(st.spent).toBe(18.5);
    expect(st.payments.map((p) => p.title)).toEqual(['农园超市', '学五食堂']);
    expect(st.reached).toBe(false);
    expect(capLeft(st, 50)).toBe(31.5);
    expect(capLeft(st, null)).toBeNull();
  });
  test('reaches the cap at or above it; none without a cap', () => {
    expect(evaluateCap(page, START, 18.5).reached).toBe(true);
    expect(evaluateCap(page, START, 10).reached).toBe(true);
    expect(evaluateCap(page, START, null).reached).toBe(false);
  });
  test('merges with earlier polls (records falling off the page are kept, no double count)', () => {
    const first = evaluateCap(page, START, 50);
    const later = evaluateCap([{ resume: '燕南食堂', tranamt: 2000, cardBalance: 6800, effectdateStr: '2026-10-23 12:40:00', icon: 'meal' }, page[0]!], START, 50, first.payments);
    expect(later.spent).toBe(38.5);
    expect(later.payments).toHaveLength(3);
  });
  test('tolerates a minute of clock skew', () => {
    const skew = evaluateCap([{ resume: 'x', tranamt: 100, cardBalance: 0, effectdateStr: '2026-10-23 11:59:30', icon: 'meal' }], START, null);
    expect(skew.spent).toBe(1);
  });
});
