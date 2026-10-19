/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { parseAnnouncements, parseAssignment, parseContent, parseCourses, parseDeadline, parseMenu } from './parse';

describe('parseCourses', () => {
  test('current and past portlets', () => {
    const html = `
      <div class="portlet"><span class="moduleTitle">当前学期课程</span>
        <ul class="courseListing"><li><a href="/webapps/blackboard/execute/launcher?type=Course&id=_1_1&url=&key=_8001_1,">00132-0: 高等数学 (2026秋)</a></li></ul></div>
      <div class="portlet"><span class="moduleTitle">历史课程</span>
        <ul class="courseListing"><li><a href="/x?key=_7001_1,">00099-0: 英语</a></li></ul></div>`;
    expect(parseCourses(html)).toEqual([
      { id: '_8001_1', title: '高等数学 (2026秋)', name: '高等数学', current: true },
      { id: '_7001_1', title: '英语', name: '英语', current: false },
    ]);
  });
});

describe('parseAnnouncements', () => {
  test('documented announcement DOM', () => {
    const html = `<ul id="announcementList">
      <li class="clearfix" id="_93301_1"><h3 class="item">期中考试安排</h3>
        <div class="details"><p><span>发布时间: 2026年10月12日 星期一 上午10时00分</span></p><p><div class="vtbegenerated">第8周周三 理教 107</div></p></div>
        <div class="announcementInfo"><p><span>发帖者:</span> 王老师</p><p><span>发布至:</span> 高等数学</p></div></li>
      <li><h3></h3></li></ul>`;
    const [a, ...rest] = parseAnnouncements(html);
    expect(rest).toHaveLength(0);
    expect(a.title).toBe('期中考试安排');
    expect(a.body).toBe('第8周周三 理教 107');
    expect(a.date).toBe('2026年10月12日 星期一 上午10时00分');
    expect(a.author).toBe('王老师');
  });
});

describe('content', () => {
  test('menu and items with types', () => {
    expect(parseMenu('<ul id="courseMenuPalette_contents"><li><a href="/webapps/blackboard/content/listContent.jsp?course_id=_8001_1&content_id=_5_1">课程作业</a></li></ul>')).toEqual([
      { name: '课程作业', url: '/webapps/blackboard/content/listContent.jsp?course_id=_8001_1&content_id=_5_1' },
    ]);
    const items = parseContent(`<ul id="content_listContainer">
      <li id="contentListItem:_11_1" class="clearfix"><img alt="作业"><h3><a href="/webapps/assignment/uploadAssignment?content_id=_11_1&course_id=_8001_1">作业一</a></h3><div class="details"><div class="vtbegenerated">第一章习题</div></div></li>
      <li class="clearfix"><img alt="内容文件夹"><h3><a href="/webapps/blackboard/content/listContent.jsp?content_id=_12_1&course_id=_8001_1">第二章</a></h3></li>
      <li class="clearfix"><h3>说明</h3></li></ul>`);
    expect(items.map((i) => [i.title, i.type, i.id])).toEqual([
      ['作业一', 'assignment', 'contentListItem:_11_1'],
      ['第二章', 'folder', '_12_1'],
      ['说明', 'document', ''],
    ]);
    expect(items[0].description).toBe('第一章习题');
  });
});

describe('assignment', () => {
  test('deadline and attempt', () => {
    const r = parseAssignment('<div class="itemdates">截止日期: 2026年10月20日 星期二 下午11:59</div><h3 id="currentAttempt_label">  尝试  2026-10-19 </h3>');
    expect(r.attempt).toBe('尝试 2026-10-19');
    expect(parseDeadline(r.deadlineText)).toBe(new Date(2026, 9, 20, 23, 59).getTime());
    expect(parseDeadline('2026年1月2日 星期五 上午12:30')).toBe(new Date(2026, 0, 2, 0, 30).getTime());
    expect(parseDeadline('无')).toBeNull();
  });
});
