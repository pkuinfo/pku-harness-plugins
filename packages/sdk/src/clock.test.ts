import { afterEach, describe, expect, test } from 'bun:test';

import { addDays, at, clockZone, dayKey, daysInMonth, parts, setClockZone, startOfDay, subscribeClockZone, type ClockZone } from './clock';
import { KATHMANDU, MINUS_8, SHANGHAI } from './testing';

const H = 3_600_000;
const M = 60_000;

afterEach(() => setClockZone('device'));

describe('zone state', () => {
  test("defaults to 'device', set and read back", () => {
    expect(clockZone()).toBe('device');
    setClockZone(SHANGHAI);
    expect(clockZone()).toEqual(SHANGHAI);
  });

  test('subscribers hear real changes only, and can unsubscribe', () => {
    let calls = 0;
    const off = subscribeClockZone(() => calls++);
    setClockZone(SHANGHAI);
    setClockZone({ ...SHANGHAI }); // same zone: no event
    setClockZone(MINUS_8);
    setClockZone('device');
    setClockZone('device');
    expect(calls).toBe(3);
    off();
    setClockZone(SHANGHAI);
    expect(calls).toBe(3);
  });

  test('rejects a non-finite offset', () => {
    expect(() => setClockZone({ id: 'x', offsetMinutes: Number.NaN })).toThrow();
  });
});

describe("'device' matches JS Date local methods", () => {
  const samples = [
    new Date(2026, 9, 18, 21, 4, 37).getTime(),
    new Date(2024, 1, 29, 0, 0, 0).getTime(),
    new Date(2027, 0, 1, 23, 59, 59).getTime(),
    Date.UTC(2026, 2, 8, 10, 30), // a US DST switch day
    Date.UTC(2026, 10, 1, 9, 15),
    0,
  ];

  test.each(samples)('parts(%p)', (ms) => {
    const d = new Date(ms);
    expect<object>(parts(ms)).toEqual({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      weekday: d.getDay() || 7,
    });
  });

  test('at, startOfDay, addDays, dayKey', () => {
    expect(at(2026, 10, 18, 21, 4, 37)).toBe(new Date(2026, 9, 18, 21, 4, 37).getTime());
    expect(at(2026, 13, 0)).toBe(new Date(2026, 12, 0).getTime());
    for (const ms of samples) {
      const d = new Date(ms);
      expect(startOfDay(ms)).toBe(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
      const later = new Date(ms);
      later.setDate(later.getDate() + 40);
      expect(addDays(ms, 40)).toBe(later.getTime());
      const pad = (n: number) => String(n).padStart(2, '0');
      expect(dayKey(ms)).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }
  });
});

const fixed: [string, { id: string; offsetMinutes: number }][] = [
  ['+08:00', SHANGHAI],
  ['-08:00', MINUS_8],
  ['+05:45', KATHMANDU],
];

describe.each(fixed)('fixed zone %s', (_label, zone) => {
  const off = zone.offsetMinutes * M;

  test('at is UTC minus the offset; parts inverts it', () => {
    setClockZone(zone);
    const t = at(2026, 10, 18, 21, 4, 37);
    expect(t).toBe(Date.UTC(2026, 9, 18, 21, 4, 37) - off);
    expect(parts(t)).toEqual({ year: 2026, month: 10, day: 18, hour: 21, minute: 4, second: 37, weekday: 7 });
  });

  test('round trips over a year of hours', () => {
    setClockZone(zone);
    for (let t = at(2026, 1, 1); t < at(2027, 1, 1); t += 7 * H + 13 * M) {
      const p = parts(t);
      expect(at(p.year, p.month, p.day, p.hour, p.minute, p.second)).toBe(t - (t % 1000));
      expect(p.month).toBeGreaterThanOrEqual(1);
      expect(p.month).toBeLessThanOrEqual(12);
      expect(p.day).toBeLessThanOrEqual(daysInMonth(p.year, p.month));
    }
  });

  test('the same instant reads differently per zone', () => {
    const instant = Date.UTC(2026, 9, 18, 20, 0); // 20:00 UTC
    setClockZone(zone);
    const p = parts(instant);
    const local = new Date(instant + off);
    expect([p.day, p.hour, p.minute]).toEqual([local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes()]);
  });

  test('rollover like new Date(y, m - 1, d, h, mi)', () => {
    setClockZone(zone);
    expect(at(2026, 3, 0)).toBe(at(2026, 2, 28)); // day 0 = last of previous month
    expect(at(2024, 3, 0)).toBe(at(2024, 2, 29));
    expect(at(2026, 1, 32)).toBe(at(2026, 2, 1)); // day 32 = into next month
    expect(at(2026, 13, 1)).toBe(at(2027, 1, 1));
    expect(at(2026, 0, 1)).toBe(at(2025, 12, 1));
    expect(at(2026, 10, 18, 24)).toBe(at(2026, 10, 19));
    expect(at(2026, 10, 18, 0, -1)).toBe(at(2026, 10, 17, 23, 59));
    expect(at(2026, 10, 18 - 30)).toBe(at(2026, 9, 18));
  });

  test('weekday: 1 = Monday … 7 = Sunday', () => {
    setClockZone(zone);
    // 2026-10-19 is a Monday.
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => parts(at(2026, 10, 19 + i, 12)).weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Near midnight the zone's own day decides.
    expect(parts(at(2026, 10, 18, 23, 59)).weekday).toBe(7);
    expect(parts(at(2026, 10, 19, 0, 0)).weekday).toBe(1);
  });

  test('startOfDay, addDays, dayKey', () => {
    setClockZone(zone);
    const t = at(2026, 10, 18, 21, 4, 37) + 250;
    expect(startOfDay(t)).toBe(at(2026, 10, 18));
    expect(startOfDay(at(2026, 10, 18))).toBe(at(2026, 10, 18));
    expect(startOfDay(at(2026, 10, 18) - 1)).toBe(at(2026, 10, 17));
    expect(addDays(t, 1)).toBe(at(2026, 10, 19, 21, 4, 37) + 250);
    expect(addDays(t, -18)).toBe(at(2026, 9, 30, 21, 4, 37) + 250);
    expect(addDays(t, 365)).toBe(at(2027, 10, 18, 21, 4, 37) + 250);
    expect(dayKey(t)).toBe('2026-10-18');
    expect(dayKey(at(2026, 10, 18) - 1)).toBe('2026-10-17');
    expect(dayKey(at(2027, 1, 1))).toBe('2027-01-01');
  });

  test('pre-epoch instants', () => {
    setClockZone(zone);
    const t = at(1969, 12, 31, 23, 30, 15) + 500;
    expect(parts(t)).toMatchObject({ year: 1969, month: 12, day: 31, hour: 23, minute: 30, second: 15, weekday: 3 });
    expect(addDays(t, 1)).toBe(at(1970, 1, 1, 23, 30, 15) + 500);
  });
});

describe('daysInMonth', () => {
  test('month lengths', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m))).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  test('leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  test('zone-independent', () => {
    for (const z of ['device', SHANGHAI, MINUS_8, KATHMANDU] as ClockZone[]) {
      setClockZone(z);
      expect(daysInMonth(2028, 2)).toBe(29);
      expect(parts(at(2028, 2, 29)).day).toBe(29);
      expect(parts(at(2027, 2, 29)).day).toBe(1);
    }
  });
});
