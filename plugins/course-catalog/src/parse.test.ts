/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { parseDeanResponse, parseDeanSchedule, parseElectiveTable, parseSelectOptions, parseTimeAndRoom, parseTotalPages, semesterCode, stripHtml } from './parse';

describe('dean (教务部)', () => {
  // Field set documented in pkucli dean.rs; sksj / teacher are HTML.
  const page = JSON.stringify({
    status: 'ok',
    count: '223',
    courselist: [
      {
        kch: '04830220',
        kcmc: '计算机系统导论',
        kctxm: '专业必修',
        kkxsmc: '信息科学技术学院',
        jxbh: '1',
        xf: '5',
        qzz: '1-15',
        sksj: '<p>星期二(第3节-第4节)</p><p>星期四(第1节-第2节)(单周)</p>',
        teacher: '<p>张三(教授)</p><p>李四</p>',
        bz: '<p>需先修程序设计</p>',
        zxjhbh: 'x',
        xh: '1',
      },
      { kch: '00132', kcmc: '体育', kctxm: '全校任选', kkxsmc: '体育教研部', jxbh: '2', xf: '1', qzz: '', sksj: '', teacher: '', bz: '' },
    ],
  });

  test('page parsing', () => {
    const { count, courses } = parseDeanResponse(page);
    expect(count).toBe(223);
    expect(courses).toHaveLength(2);
    expect(courses[0]).toEqual({
      courseId: '04830220',
      name: '计算机系统导论',
      category: '专业必修',
      classNo: '1',
      credit: '5',
      teacher: '张三(教授) 李四',
      department: '信息科学技术学院',
      schedule: '星期二(第3节-第4节) 星期四(第1节-第2节)(单周)',
      sessions: [
        { weekday: 2, periods: [3, 4], start: '10:10', end: '12:00', weeks: '1-15', weekType: 'every', room: null },
        { weekday: 4, periods: [1, 2], start: '08:00', end: '09:50', weeks: '1-15', weekType: 'odd', room: null },
      ],
      classroom: '',
      weeks: '1-15',
      remark: '需先修程序设计',
      source: 'dean',
    });
    expect(courses[1].sessions).toEqual([]);
  });

  test('errors', () => {
    expect(() => parseDeanResponse('{"status":"error"}')).toThrow('error');
    expect(() => parseDeanResponse('<html>维护中</html>')).toThrow('教务部');
    expect(parseDeanResponse('{"status":"ok","count":"0"}')).toEqual({ count: 0, courses: [] });
  });

  test('schedule variants', () => {
    expect(parseDeanSchedule('星期日（第10节-第12节）').map((s) => [s.weekday, s.start, s.end])).toEqual([[0, '18:40', '21:30']]);
    expect(parseDeanSchedule('星期三(第5节)')[0].periods).toEqual([5, 5]);
    expect(parseDeanSchedule('<p>星期一(第7节-第8节)双周</p>')[0].weekType).toBe('even');
  });

  test('strip html', () => {
    expect(stripHtml('<p>a&nbsp;&amp;</p>\n<p> b </p>')).toBe('a & b');
  });

  test('select options from the search form', () => {
    const html = `<form><select name="yearandseme" id="yearandseme"><option value="25-26-2">25-26学年第2学期</option><option value="25-26-1" selected>25-26学年第1学期</option></select>
      <select name="yuanxi"><option value="0">全部</option><option value="00048">信息科学技术学院</option><option value="00001">数学科学学院</option></select></form>`;
    expect(parseSelectOptions(html, 'yuanxi')).toEqual([
      { value: '00048', label: '信息科学技术学院' },
      { value: '00001', label: '数学科学学院' },
    ]);
    expect(parseSelectOptions(html, 'yearandseme').map((o) => o.value)).toEqual(['25-26-2', '25-26-1']);
    expect(parseSelectOptions(html, 'nope')).toEqual([]);
  });

  test('semester code', () => {
    expect(semesterCode(new Date(2026, 9, 18))).toBe('26-27-1');
    expect(semesterCode(new Date(2027, 0, 5))).toBe('26-27-1');
    expect(semesterCode(new Date(2026, 2, 1))).toBe('25-26-2');
    expect(semesterCode(new Date(2099, 11, 1))).toBe('99-00-1');
  });
});

describe('elective (选课网)', () => {
  test('time and room: the examples in elective_query.rs', () => {
    const a = parseTimeAndRoom('1~15周 每周周二5~6节 理教310');
    expect(a.schedule).toBe('1~15周 每周周二5~6节');
    expect(a.classroom).toBe('理教310');
    expect(a.weeks).toBe('1~15周');
    expect(a.sessions).toEqual([{ weekday: 2, periods: [5, 6], start: '13:00', end: '14:50', weeks: '1-15', weekType: 'every', room: '理教310' }]);

    const b = parseTimeAndRoom('1~15周 双周周一1~2节 理教309考试方式：堂考');
    expect(b.classroom).toBe('理教309');
    expect(b.sessions[0].weekType).toBe('even');

    // room glued to the next weeks expression
    const c = parseTimeAndRoom('1~15周 每周周三1~2节 三教2011~15周 每周周一3~4节 三教201');
    expect(c.sessions.map((s) => [s.weekday, s.room])).toEqual([
      [3, '三教201'],
      [1, '三教201'],
    ]);
    expect(c.classroom).toBe('三教201');
    expect(c.schedule).toBe('1~15周 每周周三1~2节; 1~15周 每周周一3~4节');

    expect(parseTimeAndRoom('')).toEqual({ schedule: '', classroom: '', weeks: '', sessions: [] });
    expect(parseTimeAndRoom('另行通知').schedule).toBe('另行通知');
    expect(parseTimeAndRoom('1~16周 单周周日10~12节 二教101（备注：线上）').sessions[0]).toMatchObject({ weekday: 0, weekType: 'odd', room: '二教101' });
  });

  test('total pages', () => {
    expect(parseTotalPages('… Page 2 of 7 …')).toBe(7);
    expect(parseTotalPages('nothing')).toBe(1);
  });

  test('course table', () => {
    const row = (cells: string[]) => `<tr>${cells.map((c) => `<td><span>${c}</span></td>`).join('')}</tr>`;
    const html = `<html><body><table class="datagrid">
      <tr><th>课程号</th><th>课程名</th></tr>
      ${row(['04830220', '计算机系统导论', '专业课', '5', '张三', '1', '信息科学技术学院', '计算机', '2024', '1~15周 每周周二3~4节 理教107', '200 / 180', '否', '&nbsp;英文授课 ', '加入'])}
      ${row(['00132380', '体育（篮球）', '体育', '1', '王五', '3', '体育教研部', '', '', '', '30 / 30', '否', '', ''])}
      <tr><td colspan="14">Page 1 of 3</td></tr>
    </table></body></html>`;
    const { courses, totalPages } = parseElectiveTable(html);
    expect(totalPages).toBe(3);
    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({
      courseId: '04830220',
      name: '计算机系统导论',
      category: '专业课',
      credit: '5',
      teacher: '张三',
      classNo: '1',
      department: '信息科学技术学院',
      classroom: '理教107',
      weeks: '1~15周',
      remark: '英文授课',
      source: 'elective',
    });
    expect(courses[0].sessions[0]).toMatchObject({ weekday: 2, start: '10:10', end: '12:00', room: '理教107' });
    expect(courses[1].sessions).toEqual([]);
  });

  test('missing table', () => {
    expect(() => parseElectiveTable('<html>您尚未登录或者会话超时</html>')).toThrow('会话');
    expect(() => parseElectiveTable('<html>目前不是选课时间</html>')).toThrow('选课网');
  });
});
