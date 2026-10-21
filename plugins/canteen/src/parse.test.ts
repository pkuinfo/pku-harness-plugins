/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { HOURS_SNAPSHOT, HOURS_SOURCE, UPDATES } from './data';
import { beijing, level, mealRange, openAt, parseCanteenNotices, parseCrowd, parseHours } from './parse';

/** Public pages / responses saved 2026-10-21. */
const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('crowd', () => {
  test('portal retrCarteenInfos.do', () => {
    const { time, canteens } = parseCrowd(fx('crowd.json'));
    expect(time).toBe('2026-10-21 09:52');
    expect(canteens).toHaveLength(22);
    expect(canteens[0]).toEqual({ name: '教师之家', diners: 10, seats: 160, percent: 6, level: '空闲' });
    expect(canteens.find((c) => c.name === '学五食堂')).toEqual({ name: '学五食堂', diners: 85, seats: 520, percent: 16, level: '空闲' });
    // Over capacity: the portal flags it with warningMsg.
    expect(canteens.at(-1)).toEqual({ name: '松林食堂', diners: 88, seats: 45, percent: 196, level: '拥挤', warning: '>100%' });
  });

  test('errors and odd values', () => {
    expect(() => parseCrowd('<html>')).toThrow('无法解析');
    expect(() => parseCrowd('{}')).toThrow('没有返回数据');
    expect(parseCrowd('{"rows":[{"name":"X","seat":"0","ip":"-3"}]}').canteens[0]).toEqual({ name: 'X', diners: 0, seats: 0, percent: 0, level: '空闲' });
  });

  test('level thresholds', () => {
    expect([0, 29, 30, 59, 60, 89, 90, 150].map(level)).toEqual(['空闲', '空闲', '适中', '适中', '较挤', '较挤', '拥挤', '拥挤']);
  });
});

describe('hours table', () => {
  const { updated, venues } = parseHours(fx('hours.html'));

  test('page date and size', () => {
    expect(updated).toBe('2022-09-09');
    expect(venues).toHaveLength(28);
  });

  test('rowspan canteen with a notes row', () => {
    expect(venues[0]).toEqual({
      canteen: '学一食堂',
      area: null,
      meals: { breakfast: '6:50-8:30（值班餐至9:00）', lunch: '11:00-13:00（值班餐至13:30）', dinner: '17:00-18:30（值班餐至19:00）' },
      notes: ['值班餐均在中厅档口开放，不含节假日'],
    });
  });

  test('colspan across meals = continuous', () => {
    expect(venues.find((v) => v.area === '四层渝火锅')).toEqual({ canteen: '家园食堂', area: '四层渝火锅', meals: { breakfast: null, lunch: '11:00-22:00', dinner: '11:00-22:00' }, continuous: [['lunch', 'dinner']] });
    expect(venues.find((v) => v.canteen === '松林快餐')?.continuous).toEqual([['breakfast', 'lunch']]);
  });

  test('佟园: two-row breakfast cell, the second row is a note', () => {
    expect(venues.filter((v) => v.canteen === '佟园食堂')).toEqual([
      { canteen: '佟园食堂', area: null, meals: { breakfast: '7:00-9:00', lunch: '11:00-13:00', dinner: '17:00-22:00' }, notes: ['假期期间，晚餐时段为17:00-20:00'] },
    ]);
  });

  test('bundled snapshot equals the parser output on the saved page', () => {
    expect(HOURS_SNAPSHOT).toEqual(venues);
    expect(HOURS_SOURCE.published).toBe(updated!);
  });

  test('missing table', () => {
    expect(() => parseHours('<html><body>改版了</body></html>')).toThrow('没找到开闭餐时间表');
  });
});

describe('open now', () => {
  test('mealRange: 值班餐 extends closing, 24:00', () => {
    expect(mealRange('6:50-8:30（值班餐至9:00）')).toEqual({ open: 410, close: 540 });
    expect(mealRange('17:00-24:00')).toEqual({ open: 1020, close: 1440 });
    expect(mealRange(null)).toBeNull();
    expect(mealRange('/')).toBeNull();
  });

  test('openAt 12:45 / 23:30', () => {
    const v = parseHours(fx('hours.html')).venues;
    const at1245 = openAt(v, 12 * 60 + 45);
    expect(at1245.find((o) => o.canteen === '学一食堂')).toEqual({ canteen: '学一食堂', area: null, hours: '11:00-13:00（值班餐至13:30）', closesInMinutes: 45 });
    expect(at1245.some((o) => o.canteen === '昌平200号食堂')).toBe(false);
    expect(openAt(v, 23 * 60 + 30).map((o) => o.canteen)).toEqual(['艺园二楼']);
  });

  test('beijing()', () => {
    expect(beijing(Date.UTC(2026, 9, 20, 16, 5))).toEqual({ date: '2026-10-21', weekday: 3, minutes: 5, time: '00:05' });
  });
});

describe('notices and updates', () => {
  test('餐饮中心 通知公告 list', () => {
    const items = parseCanteenNotices(fx('cyzx-notices.html'), 'https://cyzx.pku.edu.cn/tzgg/index.htm');
    expect(items.length).toBeGreaterThan(10);
    expect(items[2]).toEqual({ title: '关于勺园食堂停业改造、艺园食堂恢复营业的通知', date: '2026-08-17', url: 'https://cyzx.pku.edu.cn/tzgg/faff32055b2b47a4aa8b8d18c8acb3a5.htm' });
  });

  test('every static update carries a source and date', () => {
    for (const u of UPDATES) {
      expect(u.source).toStartWith('https://cyzx.pku.edu.cn/');
      expect(u.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
