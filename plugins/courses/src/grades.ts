import { parse, type HTMLElement } from 'node-html-parser';

/**
 * 我的成绩 (Blackboard Learn "My Grades", `bb-mygrades-BBLEARN/myGrades?…&stream_name=mygrades`).
 * pkucli has no grades command, so this follows Blackboard Learn 9.1's standard My Grades markup
 * (`div.sortable_item_row` rows with `.cell.gradable` / `.cell.activity` / `.cell.grade`). Best
 * effort and tolerant: unknown markup yields an empty list, never an exception. Pure.
 */

export const gradesPath = (courseId: string) => `/webapps/bb-mygrades-BBLEARN/myGrades?course_id=${courseId}&stream_name=mygrades&is_stream=false`;

export type GradeItem = {
  title: string;
  /** Column category, e.g. 作业 / 测验 / 总分. */
  category: string | null;
  /** Score as shown ("92", "A", "-" removed → null when not graded). */
  score: string | null;
  /** Points possible ("100"), without the slash. */
  possible: string | null;
  /** Status text such as 已评分 / 已提交 / 即将到期. */
  status: string | null;
  /** Last activity or due date as shown. */
  date: string | null;
  /** A calculated column (total, weighted total, average). */
  total: boolean;
};

const clean = (el: HTMLElement | null | undefined) => (el?.text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export function parseGrades(html: string): GradeItem[] {
  const dom = parse(html);
  const out: GradeItem[] = [];
  for (const row of dom.querySelectorAll('div.sortable_item_row')) {
    const cell = row.querySelector('.cell.gradable');
    if (!cell) continue;
    // Title is the first link or span directly describing the column; skip category/due lines.
    const titleEl = cell.querySelector('a') ?? cell.querySelectorAll('span').find((s) => !s.closest('.itemCat') && !s.closest('.eventDue') && clean(s)) ?? null;
    const title = clean(titleEl) || clean(cell.childNodes[0] as HTMLElement | undefined);
    if (!title) continue;
    const gradeCell = row.querySelector('.cell.grade');
    const rawScore = clean(gradeCell?.querySelector('.grade') ?? null) || (gradeCell ? clean(gradeCell).replace(clean(gradeCell.querySelector('.pointsPossible')), '').trim() : '');
    const possible = clean(gradeCell?.querySelector('.pointsPossible') ?? null).replace(/^\//, '').trim();
    const activity = row.querySelector('.cell.activity');
    const due = clean(cell.querySelector('.eventDue'));
    out.push({
      title,
      category: clean(cell.querySelector('.itemCat')) || null,
      score: rawScore && rawScore !== '-' && rawScore !== '--' ? rawScore : null,
      possible: possible || null,
      status: clean(activity?.querySelector('.activityType') ?? null) || null,
      date: clean(activity?.querySelector('.lastActivityDate') ?? null) || due || null,
      total: row.classList.contains('calculatedRow') || /总分|合计|Total/i.test(clean(cell.querySelector('.itemCat'))),
    });
  }
  return out;
}
