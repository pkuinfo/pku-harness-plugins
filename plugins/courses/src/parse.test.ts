/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { crawl } from './api';
import { parseAnnouncements, parseAssignment, parseAssignmentDetail, parseContent, parseCourses, parseDeadline, parseMenu, parsePlaybackParams, parseSubInfo, parseVideoIframe, parseVideos, redactUrl, subInfoUrl } from './parse';

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

describe('content attachments', () => {
  test('attachment names (nbsp prefix dropped) and absolute links; content ids', () => {
    const [doc] = parseContent(`<ul id="content_listContainer">
      <li id="contentListItem:_21_1" class="clearfix"><img alt="文件"><div class="item clearfix"><h3><span>第一讲 课件</span></h3></div>
        <div class="details"><div class="vtbegenerated">请课前预习</div>
        <div class="contextItemDetailsHeaders"><ul class="attachments clearfix">
          <li><a href="/bbcswebdav/pid-21-dt-content-rid-9_1/xid-9_1">&nbsp;lecture1.pdf</a></li>
          <li><a href="https://course.pku.edu.cn/bbcswebdav/xid-10_1">&nbsp;code.zip</a></li>
        </ul></div></div></li></ul>`);
    expect(doc.contentId).toBe('_21_1');
    expect(doc.type).toBe('document');
    expect(doc.description).toBe('请课前预习');
    expect(doc.attachments).toEqual([
      { name: 'lecture1.pdf', url: 'https://course.pku.edu.cn/bbcswebdav/pid-21-dt-content-rid-9_1/xid-9_1' },
      { name: 'code.zip', url: 'https://course.pku.edu.cn/bbcswebdav/xid-10_1' },
    ]);
  });
});

describe('parseAssignmentDetail', () => {
  test('newAttempt page: title, deadline, instructions, attachments, status', () => {
    const d = parseAssignmentDetail(`<span id="pageTitleText"><span class="title">作业二</span></span>
      <div class="itemdates">截止日期: 2026年11月3日 星期二 下午11:59</div>
      <div id="instructions"><div class="vtbegenerated"><p>完成习题 2.1–2.5，</p><p>提交 PDF。</p></div>
      <ul class="attachments"><li><a href="/bbcswebdav/xid-77_1">&nbsp;hw2.pdf</a></li></ul></div>
      <div class="status">未提交</div>`);
    expect(d.title).toBe('作业二');
    expect(parseDeadline(d.deadlineText)).toBe(new Date(2026, 10, 3, 23, 59).getTime());
    expect(d.instructions).toBe('完成习题 2.1–2.5，提交 PDF。');
    expect(d.attachments).toEqual([{ name: 'hw2.pdf', url: 'https://course.pku.edu.cn/bbcswebdav/xid-77_1' }]);
    expect(d.status).toBe('未提交');
    expect(d.attempt).toBeNull();
    expect(d.grade).toBeNull();
  });

  test('review page: attempt and grade (input value), ungraded "-"', () => {
    const graded = parseAssignmentDetail(`<h3 id="currentAttempt_label">尝试 2026-10-19 下午10:01</h3>
      <input id="currentAttempt_grade" value="92"><span id="currentAttempt_pointsPossible">/100</span>`);
    expect(graded.attempt).toBe('尝试 2026-10-19 下午10:01');
    expect(graded.grade).toBe('92 /100');
    expect(parseAssignmentDetail('<h3 id="currentAttempt_label">尝试</h3><span id="aggregateGrade">-</span>').grade).toBeNull();
  });
});

describe('parseVideos', () => {
  test('videoList.action rows', () => {
    const v = parseVideos(`<table><tbody id="listContainer_databody">
      <tr><th>高等数学 第3周 周二</th><td><span class="table-data-cell-value">2026-09-22 08:00</span></td>
        <td><span class="table-data-cell-value">王老师</span></td>
        <td><span class="table-data-cell-value"><a href="videoPlay.action?course_id=_8001_1&amp;sub_id=1">观看</a></span></td></tr>
      <tr><th></th></tr></tbody></table>`);
    expect(v).toEqual([
      {
        title: '高等数学 第3周 周二',
        time: '2026-09-22 08:00',
        teacher: '王老师',
        url: 'https://course.pku.edu.cn/webapps/bb-streammedia-hqy-BBLEARN/videoPlay.action?course_id=_8001_1&sub_id=1',
      },
    ]);
  });
});

describe('crawl', () => {
  const pages: Record<string, string> = {
    menu: '<ul id="courseMenuPalette_contents"><li><a href="/webapps/blackboard/content/listContent.jsp?course_id=_8_1&content_id=_1_1">课程资料</a></li><li><a href="/webapps/blackboard/execute/announcement">公告</a></li></ul>',
    _1_1: '<ul id="content_listContainer"><li class="clearfix"><h3><a href="/webapps/blackboard/content/listContent.jsp?content_id=_2_1&course_id=_8_1">第一章</a></h3></li><li class="clearfix"><h3><a href="/webapps/blackboard/content/listContent.jsp?content_id=_3_1&course_id=_8_1">第二章</a></h3></li></ul>',
    _2_1: '<ul id="content_listContainer"><li id="contentListItem:_4_1" class="clearfix"><h3>讲义</h3></li><li class="clearfix"><h3><a href="/webapps/blackboard/content/listContent.jsp?content_id=_1_1&course_id=_8_1">回到上级</a></h3></li></ul>',
    _3_1: '<ul id="content_listContainer"><li class="clearfix"><img alt="作业"><h3><a href="/webapps/assignment/uploadAssignment?content_id=_5_1&course_id=_8_1">作业一</a></h3></li></ul>',
  };
  const fetched: string[] = [];
  const services = {
    campus: {
      request: async (_s: string, { url }: { url: string }) => {
        const key = url.includes('announcement?method=search') ? 'menu' : (/content_id=([\w]+)/.exec(url)?.[1] ?? '');
        fetched.push(key);
        return { status: 200, url, headers: {}, body: pages[key] ?? '' };
      },
    },
  } as never;

  test('BFS with folder paths, cycle guard, page budget', async () => {
    const all = await crawl(services, '_8_1');
    expect(all.truncated).toBe(false);
    expect(all.pages).toBe(3);
    expect(all.items.map((i) => [i.path, i.title, i.type])).toEqual([
      ['课程资料', '第一章', 'folder'],
      ['课程资料', '第二章', 'folder'],
      ['课程资料 / 第一章', '讲义', 'document'],
      ['课程资料 / 第一章', '回到上级', 'folder'],
      ['课程资料 / 第二章', '作业一', 'assignment'],
    ]);
    expect(all.items[2].contentId).toBe('_4_1');
    fetched.length = 0;
    const one = await crawl(services, '_8_1', { maxPages: 1 });
    expect(one.truncated).toBe(true);
    expect(one.pages).toBe(1);
    expect(fetched).toEqual(['menu', '_1_1']);
  });
});

describe('redactUrl', () => {
  test('drops session tokens, keeps the rest', () => {
    expect(redactUrl('https://course.pku.edu.cn/webapps/bb-streammedia-hqy-BBLEARN/playVideo.action?token=eyJabc.def&course_id=_1_1')).toBe('https://course.pku.edu.cn/webapps/bb-streammedia-hqy-BBLEARN/playVideo.action?course_id=_1_1');
    expect(redactUrl('https://x/a?course_id=1&token=abc')).toBe('https://x/a?course_id=1');
    expect(redactUrl('https://x/a?token=abc')).toBe('https://x/a');
    expect(redactUrl('https://x/bbcswebdav/pid-1/xid-2')).toBe('https://x/bbcswebdav/pid-1/xid-2');
  });
});

describe('recording playback', () => {
  test('iframe, params, sub-info', () => {
    expect(parseVideoIframe('<div id="content"><iframe src="/webapps/bb-streammedia-hqy-BBLEARN/iframe.action?x=1"></iframe></div>')).toBe(
      'https://course.pku.edu.cn/webapps/bb-streammedia-hqy-BBLEARN/iframe.action?x=1',
    );
    expect(parseVideoIframe('<div id="content"></div>')).toBeNull();
    const p = parsePlaybackParams('https://onlineroomse.pku.edu.cn/player?course_id=123&sub_id=456&app_id=7&auth_data=a%2Bb');
    expect(p).toEqual({ courseId: '123', subId: '456', appId: '7', authData: 'a+b' });
    expect(subInfoUrl(p!)).toContain('auth_data=a%2Bb');
    expect(parsePlaybackParams('https://x/?course_id=1')).toBeNull();
    const json = JSON.stringify({ list: [{ sub_content: JSON.stringify({ save_playback: { is_m3u8: 'yes', contents: 'https://v.example/1.m3u8' } }) }] });
    expect(parseSubInfo(json)).toBe('https://v.example/1.m3u8');
    expect(() => parseSubInfo(JSON.stringify({ list: [] }))).toThrow('没有回放');
    expect(() => parseSubInfo(JSON.stringify({ list: [{ sub_content: JSON.stringify({ save_playback: { is_m3u8: 'no', contents: 'x.mp4' } }) }] }))).toThrow('格式');
  });
});
