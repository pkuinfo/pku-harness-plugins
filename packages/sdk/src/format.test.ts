import { describe, expect, test } from 'bun:test';

import { dayDiff, defineStrings, formatClock, formatCountdown, formatDay, formatLocalDate, formatLocalDateTime, formatRelative, formatWeekday, plural, weekdayName } from './format';

const now = new Date(2026, 9, 18, 21, 4, 37); // Sun 2026-10-18 21:04:37

describe('format', () => {
  test('clock', () => {
    expect(formatClock(now)).toBe('21:04');
    expect(formatClock(now, true)).toBe('21:04:37');
    expect(formatClock(new Date(2026, 0, 1, 8, 5).getTime())).toBe('08:05');
  });

  test('weekday', () => {
    expect(formatWeekday(now, 'zh-Hans')).toBe('周日');
    expect(formatWeekday(now, 'en')).toBe('Sun');
    expect(weekdayName(1, 'en')).toBe('Mon');
    expect(weekdayName(7, 'zh-Hans')).toBe('周日');
    expect(weekdayName(7, 'en')).toBe('Sun');
  });

  test('date and date-time', () => {
    expect(formatLocalDate(now, 'zh-Hans', now)).toBe('10月18日');
    expect(formatLocalDate(now, 'en', now)).toBe('Oct 18');
    const old = new Date(2025, 2, 3, 9, 30);
    expect(formatLocalDate(old, 'zh-Hans', now)).toBe('2025年3月3日');
    expect(formatLocalDate(old, 'en', now)).toBe('Mar 3, 2025');
    expect(formatLocalDateTime(old, 'en', now)).toBe('Mar 3, 2025, 09:30');
    expect(formatLocalDateTime(now, 'zh-Hans', now)).toBe('10月18日 21:04');
  });

  test('relative', () => {
    const t = now.getTime();
    expect(formatRelative(t - 10_000, 'en', t)).toBe('Just now');
    expect(formatRelative(t - 10_000, 'zh-Hans', t)).toBe('刚刚');
    expect(formatRelative(t - 3 * 60_000, 'en', t)).toBe('3 min ago');
    expect(formatRelative(t - 3 * 60_000, 'zh-Hans', t)).toBe('3 分钟前');
    expect(formatRelative(new Date(2026, 9, 18, 8, 0).getTime(), 'en', t)).toBe('08:00');
    expect(formatRelative(new Date(2026, 9, 17, 8, 0).getTime(), 'en', t)).toBe('Yesterday 08:00');
    expect(formatRelative(new Date(2026, 9, 17, 8, 0).getTime(), 'zh-Hans', t)).toBe('昨天 08:00');
    expect(formatRelative(new Date(2026, 9, 10, 8, 0).getTime(), 'en', t)).toBe('Oct 10, 08:00');
  });

  test('day', () => {
    expect(dayDiff(new Date(2026, 9, 19, 0, 1), now)).toBe(1);
    expect(formatDay(now, 'en', now)).toBe('Today');
    expect(formatDay(new Date(2026, 9, 19), 'zh-Hans', now)).toBe('明天');
    expect(formatDay(new Date(2026, 9, 17), 'en', now)).toBe('Yesterday');
    expect(formatDay(new Date(2026, 9, 21), 'en', now)).toBe('Wed');
    expect(formatDay(new Date(2026, 10, 2), 'en', now)).toBe('Nov 2');
  });

  test('countdown', () => {
    expect(formatCountdown(0, 'en')).toBe('Now');
    expect(formatCountdown(30_000, 'en')).toBe('<1 min');
    expect(formatCountdown(8 * 60_000, 'en')).toBe('8 min');
    expect(formatCountdown(8 * 60_000, 'zh-Hans')).toBe('8分钟');
    expect(formatCountdown(130 * 60_000, 'en')).toBe('2h 10m');
    expect(formatCountdown(120 * 60_000, 'zh-Hans')).toBe('2小时');
    expect(formatCountdown((3 * 1440 + 5 * 60) * 60_000, 'en')).toBe('3d 5h');
    expect(formatCountdown((3 * 1440 + 5 * 60) * 60_000, 'zh-Hans')).toBe('3天5小时');
  });

  test('plural and string tables', () => {
    expect(plural(1, 'book')).toBe('1 book');
    expect(plural(2, 'book')).toBe('2 books');
    expect(plural(2, 'person', 'people')).toBe('2 people');
    const s = defineStrings({ 'zh-Hans': { a: '一', n: (k: number) => `${k} 本` }, en: { a: 'One', n: (k: number) => plural(k, 'book') } });
    expect(s.en.n(1)).toBe('1 book');
  });
});
