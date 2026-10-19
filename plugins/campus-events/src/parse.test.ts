/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { dateRange, parseActivities, parseTalks, plain, timeOf, ymd } from './parse';

describe('parseTalks', () => {
  test('lowercase and UPPERCASE keys (serde aliases), sorted by start', () => {
    const talks = parseTalks([
      { TITLE: 'Quantum Error Correction', DEPT: '物理学院', HOST: '张老师', LOCATION: '物理楼西 108', START_TIME: '2026-10-22 15:00:00' },
      { title: '大模型推理优化', dept: '计算机学院', host: null, location: '', start_time: '2026-10-20 14:00' },
      { title: '', dept: 'x', start_time: '2026-10-21' },
    ]);
    expect(talks).toEqual([
      { title: '大模型推理优化', dept: '计算机学院', host: null, location: null, start: '2026-10-20 14:00' },
      { title: 'Quantum Error Correction', dept: '物理学院', host: '张老师', location: '物理楼西 108', start: '2026-10-22 15:00' },
    ]);
  });

  test('missing list', () => {
    expect(parseTalks(undefined)).toEqual([]);
    expect(parseTalks(null)).toEqual([]);
  });
});

describe('parseActivities', () => {
  test('fields, html intro trimmed', () => {
    const a = parseActivities(
      [
        {
          event_name: '秋季音乐会',
          event_start_time: '2026-10-19 19:00:00',
          event_location: '百周年纪念讲堂',
          event_organizer: '学生艺术团',
          event_introduction: '<p>欢迎&nbsp;大家</p>\n<p>' + '很长的介绍'.repeat(50) + '</p>',
          event_type_name: '文艺演出',
        },
        { event_name: '读书会', event_start_time: '2026-10-19', event_location: '', event_organizer: '', event_introduction: '', event_type_name: '' },
      ],
      20,
    );
    expect(a[0]).toEqual({ name: '秋季音乐会', type: '文艺演出', start: '2026-10-19 19:00', location: '百周年纪念讲堂', organizer: '学生艺术团', intro: '欢迎 大家 很长的介绍很长的介绍很长的介…' });
    expect(a[1]).toEqual({ name: '读书会', type: null, start: '2026-10-19', location: null, organizer: null, intro: null });
  });
});

describe('helpers', () => {
  test('plain', () => {
    expect(plain('<b>A</b>&amp;B  &lt;C&gt;')).toBe('A &B <C>');
    expect(plain('abcdef', 3)).toBe('abc…');
  });

  test('timeOf', () => {
    expect(timeOf('2026-10-20 14:00:00')).toBe('2026-10-20 14:00');
    expect(timeOf('2026/1/5 9:30')).toBe('2026-01-05 09:30');
    expect(timeOf('2026-10-20T06:00:00.000Z')).toBe('2026-10-20 06:00');
    expect(timeOf('下午三点')).toBe('下午三点');
    expect(timeOf(null)).toBe('');
  });

  test('dateRange defaults (commands.rs) and caps', () => {
    const now = new Date(2026, 9, 18, 22, 30);
    expect(ymd(now)).toBe('2026-10-18');
    expect(dateRange(undefined, undefined, 30, 92, now)).toEqual({ start: '2026-10-18', end: '2026-11-17', capped: false });
    expect(dateRange(undefined, undefined, 1, 31, now)).toEqual({ start: '2026-10-18', end: '2026-10-19', capped: false });
    expect(dateRange('2026-12-30', undefined, 1, 31, now)).toEqual({ start: '2026-12-30', end: '2026-12-31', capped: false });
    expect(dateRange('2026-10-01', '2027-06-01', 30, 31, now)).toEqual({ start: '2026-10-01', end: '2026-11-01', capped: true });
  });

  test('dateRange errors', () => {
    expect(() => dateRange('2026-02-30', undefined, 1, 31)).toThrow('日期格式不对');
    expect(() => dateRange('2026-10-10', '2026-10-01', 1, 31)).toThrow('结束日期早于开始日期');
  });
});
