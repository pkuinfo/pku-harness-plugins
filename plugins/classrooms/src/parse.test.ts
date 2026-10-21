/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { beijingMinutes, compact, freeRooms, normalizeBuilding, parseFree, parseSummary, periodsBetween, remainingPeriods } from './parse';

/** Public portal responses saved 2026-10-21. */
const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parse', () => {
  test('retrClassRoomFree.do (二教, today)', () => {
    const rooms = parseFree(fx('free-erjiao.json'));
    expect(rooms).toHaveLength(74);
    expect(rooms[0]).toEqual({ room: '101', capacity: 492, busy: [false, true, true, true, false, false, false, false, false, true, true, false] });
  });

  test('errors', () => {
    expect(() => parseFree('<html>')).toThrow('无法解析');
    expect(() => parseFree('{"success":false,"message":"参数错误"}')).toThrow('参数错误');
  });

  test('retrClassRoomInfos.do: buildings without rooms dropped', () => {
    const s = parseSummary(fx('buildings.json'));
    expect(s[0]).toEqual({ building: '一教', free: 16, total: 32 });
    expect(s.some((b) => b.building === '地学')).toBe(false);
    expect(s).toHaveLength(9);
  });
});

describe('periods', () => {
  test('periodsBetween', () => {
    expect(periodsBetween('14:00', '18:00')).toEqual([6, 7, 8, 9]);
    expect(periodsBetween('12:10', '12:50')).toEqual([]);
    expect(periodsBetween('19:00', '22:00')).toEqual([10, 11, 12]);
    expect(periodsBetween('19:30', '22:00')).toEqual([11, 12]);
    expect(() => periodsBetween('18:00', '14:00')).toThrow('晚于');
    expect(() => periodsBetween('25:00', '26:00')).toThrow('时间格式');
  });

  test('remainingPeriods keeps the running one', () => {
    expect(remainingPeriods(9 * 60 + 30)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(remainingPeriods(21 * 60 + 31)).toEqual([]);
  });

  test('compact', () => {
    expect(compact([1, 2, 5, 7, 8, 9, 12])).toBe('1-2,5,7-9,12');
    expect(compact([])).toBe('');
  });

  test('beijingMinutes', () => {
    expect(beijingMinutes(Date.UTC(2026, 9, 21, 1, 52))).toBe(9 * 60 + 52);
  });
});

describe('freeRooms', () => {
  const rooms = parseFree(fx('free-erjiao.json'));

  test('free for the whole afternoon, biggest first', () => {
    const r = freeRooms('二教', rooms, [5, 6, 7, 8]);
    expect(r[0]).toEqual({ building: '二教', room: '101', capacity: 492, freePeriods: '1,5-9,12', freeCount: 7 });
    expect(r.every((x) => x.capacity >= r.at(-1)!.capacity)).toBe(true);
  });

  test('minCapacity', () => {
    expect(freeRooms('二教', rooms, [5], 200).every((r) => r.capacity >= 200)).toBe(true);
  });
});

describe('normalizeBuilding', () => {
  test('names and pkucli aliases', () => {
    expect(normalizeBuilding('二教')).toBe('二教');
    expect(normalizeBuilding('2')).toBe('二教');
    expect(normalizeBuilding('LI')).toBe('理教');
    expect(normalizeBuilding('第三教学楼')).toBe('三教');
    expect(normalizeBuilding('光华楼')).toBeNull();
  });
});
