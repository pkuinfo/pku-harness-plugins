/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { TRIPS } from './data';
import { beijing, dayTypeOf, formatIn, nextDepartures, parseBeijing, parseRoute, quickAnswer, resolvePlace, timetable } from './schedule';

/** Beijing wall time → epoch ms (2026-10-21 is a Wednesday, 2026-10-24 a Saturday). */
const at = (s: string) => parseBeijing(s)!;

describe('Beijing time', () => {
  test('independent of the device zone', () => {
    expect(beijing(Date.UTC(2026, 9, 20, 23, 30))).toEqual({ date: '2026-10-21', weekday: 3, minutes: 450, text: '2026-10-21 07:30' });
    expect(beijing(at('2026-10-21 07:30')).text).toBe('2026-10-21 07:30');
  });

  test('parseBeijing rejects garbage', () => {
    expect(parseBeijing('2026-02-30 08:00')).toBeNull();
    expect(parseBeijing('tomorrow')).toBeNull();
    expect(parseBeijing('2026-10-21T9:05')).toBe(Date.UTC(2026, 9, 21, 1, 5));
  });

  test('dayTypeOf', () => {
    expect(dayTypeOf(0)).toBe('holiday');
    expect(dayTypeOf(6)).toBe('holiday');
    expect(dayTypeOf(3)).toBe('weekday');
  });
});

describe('data', () => {
  test('counts match the published tables', () => {
    const count = (line: string, days: string) => TRIPS.filter((t) => t.line === line && t.days === days).length;
    expect(count('commute', 'weekday')).toBe(18);
    expect(count('commute', 'holiday')).toBe(9);
    expect(count('beianhe', 'weekday')).toBe(16);
    expect(count('beianhe', 'holiday')).toBe(16);
  });

  test('every trip starts with a time', () => {
    expect(TRIPS.every((t) => /^\d{2}:\d{2}$/.test(t.stops[0].time ?? ''))).toBe(true);
  });
});

describe('places', () => {
  test('resolvePlace', () => {
    expect(resolvePlace('本部')).toBe('yanyuan');
    expect(resolvePlace('燕园校区')).toBe('yanyuan');
    expect(resolvePlace('新燕园')).toBe('xinyanyuan');
    expect(resolvePlace('昌平新校区')).toBe('xinyanyuan');
    expect(resolvePlace('200号')).toBe('lab200');
    expect(resolvePlace('北安河地铁')).toBe('beianhe');
    expect(resolvePlace('五道口')).toBeNull();
    expect(resolvePlace('')).toBeNull();
  });

  test('parseRoute', () => {
    expect(parseRoute('燕园到新燕园')).toEqual({ from: 'yanyuan', to: 'xinyanyuan' });
    expect(parseRoute('新燕园到燕园')).toEqual({ from: 'xinyanyuan', to: 'yanyuan' });
    expect(parseRoute('从昌平回本部')).toEqual({ from: 'xinyanyuan', to: 'yanyuan' });
    expect(parseRoute('新燕园 北安河')).toEqual({ from: 'xinyanyuan', to: 'beianhe' });
    expect(parseRoute('去200号')).toEqual({ from: null, to: 'lab200' });
    expect(parseRoute('燕园')).toEqual({ from: 'yanyuan', to: null });
    expect(parseRoute('')).toEqual({ from: null, to: null });
    expect(parseRoute('Yanyuan to Xinyanyuan')).toEqual({ from: 'yanyuan', to: 'xinyanyuan' });
    expect(parseRoute('from Changping to main campus')).toEqual({ from: 'xinyanyuan', to: 'yanyuan' });
    expect(parseRoute('to Bei’anhe')).toEqual({ from: null, to: 'beianhe' });
    expect(parseRoute('xinyanyuan beianhe')).toEqual({ from: 'xinyanyuan', to: 'beianhe' });
  });
});

describe('nextDepartures', () => {
  test('weekday morning 燕园→新燕园', () => {
    const d = nextDepartures({ from: 'yanyuan', to: 'xinyanyuan', nowMs: at('2026-10-21 07:10'), count: 3 });
    expect(d.map((x) => x.time)).toEqual(['07:40', '08:30', '10:10']);
    expect(d[0]).toMatchObject({ date: '2026-10-21', weekday: '周三', inMinutes: 30, from: '燕园校区', boardAt: '金光生命科学大厦南侧', to: '新燕园校区', route: '燕园校区→新燕园校区→200号校园' });
  });

  test('departure at the current minute still counts', () => {
    expect(nextDepartures({ from: 'yanyuan', to: 'xinyanyuan', nowMs: at('2026-10-21 07:40'), count: 1 })[0]).toMatchObject({ time: '07:40', inMinutes: 0 });
  });

  test('新燕园→燕园 includes runs that start at 200号 (time at 新燕园)', () => {
    const d = nextDepartures({ from: 'xinyanyuan', to: 'yanyuan', nowMs: at('2026-10-21 16:35'), count: 3 });
    expect(d.map((x) => x.time)).toEqual(['16:50', '19:20', '21:45']);
    expect(d[0].route).toBe('200号校园→新燕园校区→西二旗→肖家河→燕园校区');
  });

  test('intermediate stop without a published time is approx', () => {
    const d = nextDepartures({ from: 'xiaojiahe', to: 'xinyanyuan', nowMs: at('2026-10-21 06:00'), count: 2 });
    // Only the 07:00 run passes 肖家河 towards 新燕园; the next one is tomorrow's.
    expect(d.map((x) => `${x.date} ${x.time}`)).toEqual(['2026-10-21 07:00', '2026-10-22 07:00']);
    expect(d[0]).toMatchObject({ approx: true, from: '肖家河' });
  });

  test('late evening rolls over to tomorrow', () => {
    const d = nextDepartures({ from: 'yanyuan', to: 'xinyanyuan', nowMs: at('2026-10-21 22:30'), count: 2 });
    expect(d.map((x) => `${x.date} ${x.time}`)).toEqual(['2026-10-22 07:00', '2026-10-22 07:40']);
    expect(d[0].inMinutes).toBe(510);
  });

  test('Friday night → Saturday uses the weekend table', () => {
    const d = nextDepartures({ from: 'yanyuan', to: 'xinyanyuan', nowMs: at('2026-10-23 22:10'), count: 2 });
    expect(d.map((x) => `${x.weekday} ${x.time}`)).toEqual(['周六 07:00', '周六 15:00']);
  });

  test('dayType override (public holiday on a weekday)', () => {
    const d = nextDepartures({ from: 'xinyanyuan', to: 'yanyuan', nowMs: at('2026-10-21 08:30'), count: 2, dayType: 'holiday' });
    expect(d.map((x) => x.time)).toEqual(['09:00', '11:00']);
  });

  test('北安河 express bus both ways', () => {
    expect(nextDepartures({ from: 'xinyanyuan', to: 'beianhe', nowMs: at('2026-10-24 12:30'), count: 2 }).map((x) => x.time)).toEqual(['13:00', '14:00']);
    const back = nextDepartures({ from: 'beianhe', to: 'xinyanyuan', nowMs: at('2026-10-21 21:00'), count: 1 })[0];
    expect(back).toMatchObject({ time: '21:40', from: '地铁北安河站', to: '马池口政府中街南' });
  });

  test('no route', () => {
    expect(nextDepartures({ from: 'beianhe', to: 'yanyuan', nowMs: at('2026-10-21 08:00') })).toEqual([]);
  });
});

describe('display', () => {
  test('formatIn', () => {
    const base = { date: '2026-10-21', weekday: '周三', time: '09:00', from: '', boardAt: '', to: '', route: '', line: '' };
    expect(formatIn({ ...base, inMinutes: 0 }, '2026-10-21')).toBe('即将发车');
    expect(formatIn({ ...base, inMinutes: 8 }, '2026-10-21')).toBe('8 分钟后');
    expect(formatIn({ ...base, inMinutes: 65 }, '2026-10-21')).toBe('1 小时 5 分钟后');
    expect(formatIn({ ...base, inMinutes: 120 }, '2026-10-21')).toBe('2 小时后');
    expect(formatIn({ ...base, date: '2026-10-22', weekday: '周四', inMinutes: 600 }, '2026-10-21')).toBe('周四 09:00');
  });

  test('timetable groups', () => {
    const g = timetable('holiday', 'commute');
    expect(g.map((x) => x.direction)).toEqual(['燕园校区→新燕园校区', '新燕园校区→燕园校区']);
    expect(g[0].runs.map((r) => r.time)).toEqual(['07:00', '15:00', '19:00', '22:00']);
    const w = timetable('weekday', 'commute');
    expect(w.find((x) => x.direction === '200号校园→燕园校区')?.runs[0].route).toBe('200号校园→新燕园校区(16:50)→西二旗→肖家河→燕园校区');
  });

  test('quickAnswer', () => {
    const text = quickAnswer('', at('2026-10-21 07:10'));
    expect(text).toContain('燕园校区 → 新燕园校区：07:40、08:30、10:10（30 分钟后）');
    expect(text).toContain('新燕园校区 → 燕园校区：07:40、08:30、11:20');
    expect(quickAnswer('北安河到新燕园', at('2026-10-21 22:00'))).toContain('地铁北安河站 → 新燕园校区：周四 09:40');
  });
});
