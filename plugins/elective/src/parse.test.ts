/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { parseElected, parseNotice, parseQuota, parseResults, parseSupplements, parseTotalPages } from './parse';

// Fixtures follow the shapes pkucli api.rs reads: table.datagrid, header row first, 10+ <td>
// per course row, a short pagination row, and the pager in tr[align=right] > td.

const td = (cells: string[]) => `<tr class="datagrid-odd">${cells.map((c) => `<td class="datagrid">${c}</td>`).join('')}</tr>`;

describe('parseResults', () => {
  const header = '<tr class="datagrid-header"><th>课程号</th><th>课程名</th><th>课程类别</th><th>学分</th><th>周学时</th><th>教师</th><th>班号</th><th>开课单位</th><th>教室信息</th><th>选课结果</th></tr>';
  test('header-mapped rows, skips pagination rows', () => {
    const html = `<table class="datagrid">${header}
      ${td(['04830041', '<a href="#">数据结构与算法</a>', '专业必修', '3.0', '3.0', '张三', '1', '信息科学技术学院', '周一 1~2 节 理教 107', '已选上'])}
      ${td(['00132380', '高等数学 (B)', '公共基础', '5.0', '5.0', '李四&nbsp;', '2', '数学科学学院', '周三 3~4 节 二教 101', '待抽签'])}
      <tr><td colspan="10">Page 1 of 1</td></tr></table>`;
    expect(parseResults(html)).toEqual([
      { code: '04830041', name: '数据结构与算法', category: '专业必修', credit: '3.0', hours: '3.0', teacher: '张三', classId: '1', department: '信息科学技术学院', info: '周一 1~2 节 理教 107', status: '已选上' },
      { code: '00132380', name: '高等数学 (B)', category: '公共基础', credit: '5.0', hours: '5.0', teacher: '李四', classId: '2', department: '数学科学学院', info: '周三 3~4 节 二教 101', status: '待抽签' },
    ]);
  });

  test('falls back to pkucli positions without a recognisable header', () => {
    const html = `<table class="datagrid"><tr><td>x</td></tr>${td(['C1', '课A', '通识', '2', '2', '王五', '3', '历史学系', '地点', '未选上'])}</table>`;
    expect(parseResults(html)?.[0]).toMatchObject({ code: 'C1', name: '课A', teacher: '王五', classId: '3', info: '地点', status: '未选上' });
  });

  test('null when there is no datagrid', () => {
    expect(parseResults('<html><body>目前不是选课时间</body></html>')).toBeNull();
  });
});

describe('补退选', () => {
  const supplyCancel = `
    <table class="datagrid"><tr><th>课程名</th></tr></table>
    <table class="datagrid"><tr><th>课程号</th><th>课程名</th><th>课程类别</th><th>学分</th><th>周学时</th><th>教师</th><th>班号</th><th>开课单位</th><th>年级</th><th>限数/已选</th></tr>
      ${td(['04830041', '数据结构与算法', '专业必修', '3.0', '3.0', '张三', '1', '信息科学技术学院', '2024级', '120 / 118'])}</table>
    <table><tr align="right"><td>Page 1 of 12 <a href="#">Next</a></td></tr></table>`;

  test('elected courses are the second datagrid', () => {
    expect(parseElected(supplyCancel)).toEqual([
      { code: '04830041', name: '数据结构与算法', category: '专业必修', credit: '3.0', hours: '3.0', teacher: '张三', classId: '1', department: '信息科学技术学院', info: '2024级', status: '120 / 118' },
    ]);
    expect(parseElected('<table class="datagrid"></table>')).toEqual([]);
  });

  test('total pages reads multi-digit counts, defaults to 1', () => {
    expect(parseTotalPages(supplyCancel)).toBe(12);
    expect(parseTotalPages('<table><tr align="right"><td>Page 3 of 3</td></tr></table>')).toBe(3);
    expect(parseTotalPages('<p>nothing</p>')).toBe(1);
  });

  test('supplement rows: status at max(len-3, 9) without a header (api.rs)', () => {
    const row = ['C9', '人工智能引论', '通选', '2.0', '2.0', '赵六', '1', '智能学院', '2026级', '周二 7~8 节', '100/100/5', '补选', '<a href="/elective2008/edu/pku/stu/elective/controller/supplement/electSupplement.do?index=3&seq=x">补选</a>'];
    const html = `<table class="datagrid"><tr><td>?</td></tr>${td(row)}<tr><td>1</td><td>2</td></tr></table>`;
    const [c] = parseSupplements(html)!;
    expect(c).toMatchObject({ name: '人工智能引论', teacher: '赵六', classId: '1', status: '100/100/5' });
  });

  test('supplement rows by header label', () => {
    const header = '<tr><th>课程号</th><th>课程名</th><th>课程类别</th><th>学分</th><th>周学时</th><th>教师</th><th>班号</th><th>开课单位</th><th>年级</th><th>上课/考试信息</th><th>限数/已选</th><th>补选</th></tr>';
    const html = `<table class="datagrid">${header}${td(['C9', '人工智能引论', '通选', '2.0', '2.0', '赵六', '1', '智能学院', '2026级', '周二 7~8 节 理教 203', '150 / 120', '<a href="#">补选</a>'])}</table>`;
    expect(parseSupplements(html)).toEqual([
      { code: 'C9', name: '人工智能引论', category: '通选', credit: '2.0', hours: '2.0', teacher: '赵六', classId: '1', department: '智能学院', info: '周二 7~8 节 理教 203', status: '150 / 120' },
    ]);
  });
});

describe('parseQuota', () => {
  test('limit / elected / waitlist (api.rs is_full)', () => {
    expect(parseQuota('150 / 120')).toEqual({ limit: 150, elected: 120, waitlist: null, remaining: 30, full: false });
    expect(parseQuota('100/100/5')).toEqual({ limit: 100, elected: 100, waitlist: 5, remaining: 0, full: true });
    expect(parseQuota('30/45')).toMatchObject({ remaining: 0, full: true });
    expect(parseQuota('已选上')).toBeNull();
    expect(parseQuota('')).toBeNull();
  });
});

describe('parseNotice', () => {
  test('msgTips first, then title', () => {
    expect(parseNotice('<table><tr><td id="msgTips">目前不是补退选时间</td></tr></table>')).toBe('目前不是补退选时间');
    expect(parseNotice('<html><head><title>系统提示</title></head></html>')).toBe('系统提示');
    expect(parseNotice('<p></p>')).toBeNull();
  });
});
