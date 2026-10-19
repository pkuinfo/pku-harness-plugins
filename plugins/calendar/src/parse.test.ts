/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { bundlePath, currentSemester, datesIn, extractText, interpretSemester, mondayOf, parseBundle, semesters, unescapeJs } from './parse';

/**
 * A minified bundle shaped like simso's (pkucli calendar.rs comments): tab labels, Home's
 * `components:{Calendar<tag>:<var>}`, `<var>=<mod>.exports`, the `Object(o["a"])(data,render,…)`
 * wrapper and render functions with `"第一学期"===t.xq?[…]` branches. The 2526 tab points at a
 * data block still *named* "Calendar2425" (simso reuses .vue files) — names must be ignored.
 */
const BUNDLE = [
  'var Home={name:"Home",components:{Calendar2425:p,Calendar2526:g},render:function(){var t=this;return t._c("el-tabs",[t._c("el-tab-pane",{attrs:{label:"2024-2025学年",name:"2425"}}),t._c("el-tab-pane",{attrs:{label:"2025-2026学年",name:"2526"}})])}};',
  // Old year: data block "a", render "r".
  'a={name:"Calendar2425",props:["xq"]},',
  'r=function(){var t=this,e=t.$createElement,n=t._self._c||e;return n("div",["第一学期"===t.xq?[n("p",[t._v("2024年9月9日（星期一）开始上课")]),n("p",[t._v("旧学年")])]:t._e(),"第二学期"===t.xq?[n("p",[t._v("2025年2月17日开始上课")])]:t._e()],2)},',
  'u=(i("x1"),Object(o["a"])(a,r,[],!1,null,null,null)),p=u.exports,',
  // New year: data block reuses name "Calendar2425" but is wired to render "_".
  'c={name:"Calendar2425",props:["xq"],methods:{}},',
  '_=function(){var t=this,e=t.$createElement,n=t._self._c||e;return n("div",[',
  '"第一学期"===t.xq?[n("td",[t._v("9月6日-7日")]),n("td",[t._v("新生报到注册")]),n("p",[t._v("9月8日（星期一）开始上课")]),n("p",[t._v("国庆节、中秋节放假：10月1日至8日")]),n("p",[t._v("国庆节、中秋节放假：10月1日至8日")]),n("p",[t._v("期末考试：12月29日-2026年1月11日")]),n("p",[t._v("寒假：1月12日—2月22日")]),n("p",[t._v("  ")])]:t._e(),',
  '"第二学期"===t.xq?[n("p",[t._v("2026年2月23日开始上课，本学期共18周")]),n("p",[t._v("清明节放假：4月4日至6日")]),n("p",[t._v("劳动节放假：5月1日-5日")]),n("p",[t._v("期末考试：6月15日-6月28日")]),n("p",[t._v("说明：\\"校历\\"以教务部通知为准")])]:t._e()',
  '],2)},',
  'm=(i("x2"),Object(o["a"])(c,_,[],!1,null,"abc",null)),g=m.exports,',
  // A later, unrelated render function bounds the segment.
  'zz=function(){var t=this,e=t.$createElement;return t._v("不属于校历")};',
].join('');

describe('bundle', () => {
  test('bundle path from the entry page', () => {
    expect(bundlePath('<script src=js/chunk-vendors.1a2b.js></script><script src=js/ccSchoolCalendar.0f3e9a.js></script>')).toBe('js/ccSchoolCalendar.0f3e9a.js');
    expect(bundlePath('<html></html>')).toBeNull();
  });

  test('follows the webpack wiring, not component names', () => {
    const years = parseBundle(BUNDLE);
    expect(years.map((y) => y.year)).toEqual(['2024-2025', '2025-2026']);
    expect(years[0].first).toEqual(['2024年9月9日（星期一）开始上课', '旧学年']);
    expect(years[0].second).toEqual(['2025年2月17日开始上课']);
    const cur = years[1];
    expect(cur.first[0]).toBe('9月6日-7日');
    // consecutive duplicate dropped, blank dropped
    expect(cur.first.filter((l) => l.startsWith('国庆')).length).toBe(1);
    expect(cur.first).not.toContain('');
    expect(cur.second.at(-1)).toBe('说明："校历"以教务部通知为准');
    expect(cur.second.join()).not.toContain('不属于校历');
  });

  test('throws when simso changed', () => {
    expect(() => parseBundle('var x=1')).toThrow('simso');
  });

  test('text node extraction and unescape', () => {
    expect(extractText('t._v("a"),t._v("a"),t._v(" b "),t._v("a")')).toEqual(['a', 'b', 'a']);
    expect(unescapeJs('\\u7b2c\\n\\"x\\"\\\\')).toBe('第\n"x"\\');
  });
});

describe('interpretation', () => {
  test('dates with academic-year inference', () => {
    expect(datesIn('国庆节放假：10月1日至8日', '2025-2026', 'first')).toEqual([['2025-10-01', '2025-10-08']]);
    expect(datesIn('期末考试：12月29日-1月11日', '2025-2026', 'first')).toEqual([['2025-12-29', '2026-01-11']]);
    expect(datesIn('劳动节 5月1日-5日', '2025-2026', 'second')).toEqual([['2026-05-01', '2026-05-05']]);
    expect(datesIn('2025.9.8 开学', '2025-2026', 'first')).toEqual([['2025-09-08', '2025-09-08']]);
    expect(datesIn('9月8日（星期一）开始上课', '2025-2026', 'first')).toEqual([['2025-09-08', '2025-09-08']]);
  });

  test('monday of a date', () => {
    expect(mondayOf('2025-09-10')).toBe('2025-09-08');
    expect(mondayOf('2025-09-08')).toBe('2025-09-08');
    expect(mondayOf('2025-09-14')).toBe('2025-09-08');
  });

  test('first semester: start, exams → weeks, holidays, split nodes', () => {
    const [, cur] = parseBundle(BUNDLE);
    const s = interpretSemester(cur.year, 'first', cur.first);
    expect(s.name).toBe('2025-2026学年第一学期');
    expect(s.start).toBe('2025-09-08');
    // 2026-01-11 is the Sunday of week 18
    expect(s.weeks).toBe(18);
    expect(s.weeksFrom).toBe('exams');
    expect(s.exams).toEqual([{ name: '期末考试', start: '2025-12-29', end: '2026-01-11', text: '期末考试：12月29日-2026年1月11日' }]);
    expect(s.holidays.map((h) => [h.name, h.start, h.end])).toEqual([
      ['国庆节 中秋节放假', '2025-10-01', '2025-10-08'],
      ['寒假', '2026-01-12', '2026-02-22'],
    ]);
    // the date cell joined with its description cell
    expect(s.events[0]).toMatchObject({ start: '2025-09-06', end: '2025-09-07', text: '9月6日-7日 新生报到注册' });
  });

  test('second semester: stated weeks win', () => {
    const [, cur] = parseBundle(BUNDLE);
    const s = interpretSemester(cur.year, 'second', cur.second);
    expect(s.start).toBe('2026-02-23');
    expect(s.weeks).toBe(18);
    expect(s.weeksFrom).toBe('stated');
    expect(s.holidays.map((h) => h.start)).toEqual(['2026-04-04', '2026-05-01']);
  });

  test('start from registration when no 上课 line; unknown weeks stay null', () => {
    const s = interpretSemester('2026-2027', 'first', ['9月10日-11日 本科生报到注册', '选课：9月1日至9月12日']);
    expect(s.start).toBe('2026-09-14');
    expect(s.weeks).toBeNull();
  });

  test('current semester selection', () => {
    const list = semesters(parseBundle(BUNDLE));
    expect(currentSemester(list, '2025-10-18')?.name).toBe('2025-2026学年第一学期');
    expect(currentSemester(list, '2026-02-01')?.name).toBe('2025-2026学年第二学期'); // upcoming within 60 days
    expect(currentSemester(list, '2026-03-10')?.name).toBe('2025-2026学年第二学期');
    expect(currentSemester(list, '2026-08-20')?.name).toBe('2025-2026学年第二学期'); // most recent
  });
});

describe('simso Vite build (2026)', () => {
  // Shape of the real bundle (simso.pku.edu.cn/js/ccSchoolCalendar.<vitehash>.js, 2026-10).
  const js = [
    'label:"2026-2027学年",name:"2627"',
    'components:{Calendar2627:S}',
    'h=function(){var e=this,t=e._self._c;return t("div",[e.xq==="第一学期"?[t("el-descriptions-item",{attrs:{label:"六、上课"}},[t("li",[e._v("校本部：9月7日")]),t("li",[e._v("医学部：")])]),',
    't("el-descriptions-item",{attrs:{label:"十二、停课复习考试"}},[t("li",[e._v("校本部、医学部：12月28日至1月10日")])])]:e._e(),',
    'e.xq==="第二学期"?[t("el-descriptions-item",{attrs:{label:"一、上课"}},[t("li",[e._v("校本部：2月22日")])])]:e._e(),',
    'e.xq==="上课时间"?[e._v("第一节 8:00")]:e._e()])},f=[],k=s(u,h,f,!1,null,"b2890cff");const S=k.exports,',
    'x=function(){var e=this,t=e._self._c;return t("div")}',
  ].join('');

  test('bundle path accepts Vite hashes and skips legacy', () => {
    expect(bundlePath('<script src="../js/ccSchoolCalendar-legacy.D2anCUWM.js"></script><script src="../js/ccSchoolCalendar.DP5SXWAy.js">')).toBe('js/ccSchoolCalendar.DP5SXWAy.js');
  });

  test('section headings with dates on the next line', () => {
    const [y] = parseBundle(js);
    expect(y.year).toBe('2026-2027');
    expect(y.first).toContain('六、上课');
    expect(y.second).not.toContain('第一节 8:00');
    const sem = semesters([y]).find((s) => s.semester === 'first');
    expect(sem?.start).toBe('2026-09-07');
    expect(sem?.weeks).toBe(18);
  });
});
