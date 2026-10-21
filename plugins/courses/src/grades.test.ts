/// <reference types="bun" />
import { expect, test } from 'bun:test';

import { parseGrades } from './grades';

test('My Grades rows: graded, ungraded, total', () => {
  const items = parseGrades(`<div id="grades_wrapper">
    <div class="sortable_item_row graded_item_row row expanded">
      <div class="cell gradable"><a href="#">作业一</a><div class="itemCat">作业</div><div class="eventDue"><span class="label">截止日期:</span> 2026-10-20</div></div>
      <div class="cell activity timestamp"><span class="lastActivityDate">2026年10月21日</span><div class="activityType">已评分</div></div>
      <div class="cell grade"><span class="grade">92.00</span><span class="pointsPossible clearfloats">/100</span></div>
    </div>
    <div class="sortable_item_row row upcoming_item_row">
      <div class="cell gradable"><span>期中报告</span><div class="itemCat">作业</div><div class="eventDue">截止日期: 2026-11-15</div></div>
      <div class="cell activity"><div class="activityType">即将到期</div></div>
      <div class="cell grade"><span class="grade">-</span><span class="pointsPossible">/100</span></div>
    </div>
    <div class="sortable_item_row calculatedRow row">
      <div class="cell gradable"><span>总分</span><div class="itemCat">合计</div></div>
      <div class="cell grade"><span class="grade">92.00</span></div>
    </div>
    <div class="sortable_item_row"><div class="cell gradable"></div></div>
  </div>`);
  expect(items).toEqual([
    { title: '作业一', category: '作业', score: '92.00', possible: '100', status: '已评分', date: '2026年10月21日', total: false },
    { title: '期中报告', category: '作业', score: null, possible: '100', status: '即将到期', date: '截止日期: 2026-11-15', total: false },
    { title: '总分', category: '合计', score: '92.00', possible: null, status: null, date: null, total: true },
  ]);
  expect(parseGrades('<html>没有成绩</html>')).toEqual([]);
});
