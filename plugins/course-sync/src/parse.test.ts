/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { locationOf, parseCourseTable, periodOf, periodTimes, weeksOf } from './parse';

describe('periodOf', () => {
  test('chinese and digit labels', () => {
    expect(periodOf('第一节')).toBe(1);
    expect(periodOf('第十节')).toBe(10);
    expect(periodOf('第十二节')).toBe(12);
    expect(periodOf('第二十节')).toBe(20);
    expect(periodOf('3')).toBe(3);
    expect(periodOf('午休')).toBeNull();
  });
});

describe('weeksOf', () => {
  test('ranges with odd/even', () => {
    expect(weeksOf('1-16周 理教107')).toHaveLength(16);
    expect(weeksOf('1-15周(单) 二教203')).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    expect(weeksOf('2-16周双')).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(weeksOf('每周')).toBeNull();
    expect(weeksOf(null)).toBeNull();
  });
});

describe('parseCourseTable', () => {
  const name = (n: string, info = '1-16周') => ({ courseName: `${n}<br>上课信息：${info}<br>考试信息：待定`, sty: 'background-color: lightgreen' });
  const rows = [
    { timeNum: '第一节', mon: name('高等数学'), wed: null },
    { timeNum: '第二节', mon: name('高等数学'), wed: name('英语') },
    { timeNum: '第三节', mon: { courseName: '' }, wed: name('英语') },
    { timeNum: '第四节', mon: name('高等数学') },
    { timeNum: '第五节', sun: name('体育', '1-15周(单)') },
  ];

  test('merges consecutive periods per day, splits gaps', () => {
    const m = parseCourseTable(rows);
    expect(m.map((x) => [x.name, x.weekday, x.firstPeriod, x.lastPeriod])).toEqual([
      ['高等数学', 1, 1, 2],
      ['高等数学', 1, 4, 4],
      ['英语', 3, 2, 3],
      ['体育', 0, 5, 5],
    ]);
  });

  test('keeps the class info and parses weeks', () => {
    const pe = parseCourseTable(rows).find((x) => x.name === '体育');
    expect(pe?.info).toBe('1-15周(单)');
    expect(pe?.weeks).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
  });
});

describe('periodTimes', () => {
  test('overrides defaults with server times', () => {
    const t = periodTimes([{ name: '第一节', time_period: '8:00-8:50' }, { name: '第二节', time_period: 'bad' }]);
    expect(t[1]).toEqual(['08:00', '08:50']);
    expect(t[2]).toEqual(['09:00', '09:50']);
  });
});

describe('locationOf', () => {
  test('real course-table notes', () => {
    expect(locationOf('每周 备注：与本科生合上，物理楼北547')).toBe('物理楼北547');
    expect(locationOf('1-16周 理教107')).toBe('理教107');
    expect(locationOf('1-15周(单) 二教 203')).toBe('二教203');
    expect(locationOf('每周 备注：本研合上，上课地点见本科生课表')).toBeNull();
    expect(locationOf('每周 备注：与本科生合上，物理楼北547，一学年的课，本学期选课，下学期登成绩。')).toBe('物理楼北547');
    expect(locationOf(null)).toBeNull();
  });
});
