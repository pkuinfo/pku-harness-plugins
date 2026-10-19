import { parse, type HTMLElement } from 'node-html-parser';

/**
 * 选课网 page parsing, ported from pkucli crates/elective/src/api.rs (`parse_datagrid_table`,
 * `parse_supplement_table`, `parse_total_pages`). Pure: HTML in, data out.
 *
 * pkucli reads columns by position (课程号 at 0, then 课程名…). The pages carry a header row,
 * so columns are mapped by header label when it is there and fall back to pkucli's positions.
 */

export type CourseRow = {
  code: string;
  name: string;
  category: string;
  credit: string;
  hours: string;
  teacher: string;
  classId: string;
  department: string;
  /** 教室信息 / 上课考试信息 (results, supplements) or 年级 (elected list). */
  info: string;
  /** 选课结果 (results) or 限数/已选[/候补] (elected list, supplements). */
  status: string;
};

type Field = keyof CourseRow;

const text = (el: HTMLElement | null | undefined) => (el?.text ?? '').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();

/** Header labels per field, most specific first. */
const LABELS: Record<Field, string[]> = {
  code: ['课程号'],
  name: ['课程名'],
  category: ['课程类别', '类别'],
  credit: ['学分'],
  hours: ['周学时'],
  teacher: ['教师'],
  classId: ['班号'],
  department: ['开课单位'],
  info: ['教室信息', '上课考试信息', '上课/考试信息', '年级'],
  status: ['选课结果', '限数/已选', '限数'],
};

/** pkucli's positions: cells[0] 课程号, cells[1..=9] the rest (api.rs CourseData). */
const POSITIONS: Record<Field, number> = { code: 0, name: 1, category: 2, credit: 3, hours: 4, teacher: 5, classId: 6, department: 7, info: 8, status: 9 };

function headerMap(header: HTMLElement | undefined): Record<Field, number> | null {
  if (!header) return null;
  const labels = header.querySelectorAll('th, td').map((c) => text(c).replace(/\s/g, ''));
  const map = {} as Record<Field, number>;
  for (const field of Object.keys(LABELS) as Field[]) {
    let idx = -1;
    for (const label of LABELS[field]) {
      idx = labels.findIndex((l) => l.includes(label));
      if (idx >= 0) break;
    }
    map[field] = idx;
  }
  return map.name >= 0 ? map : null;
}

function readRows(table: HTMLElement, supplement: boolean): CourseRow[] {
  const [header, ...rows] = table.querySelectorAll('tr');
  const map = headerMap(header);
  const out: CourseRow[] = [];
  for (const row of rows) {
    const cells = row.querySelectorAll('td').map(text);
    // Pagination rows and the like (api.rs: <= 3 cells), then the 10-column minimum.
    if (cells.length < 10) continue;
    const at = (field: Field) => {
      const i = map?.[field] ?? -1;
      if (i >= 0) return cells[i] ?? '';
      // parse_supplement_table: status may be 限数/已选 or 限数/已选/候补, at max(len-3, 9).
      if (field === 'status' && supplement) return cells[Math.max(cells.length - 3, 9)] ?? '';
      return map ? '' : (cells[POSITIONS[field]] ?? '');
    };
    const course = Object.fromEntries((Object.keys(POSITIONS) as Field[]).map((f) => [f, at(f)])) as CourseRow;
    if (course.name) out.push(course);
  }
  return out;
}

const grids = (html: string) => parse(html).querySelectorAll('table.datagrid');

/** showResults.do (api.rs get_results): first table.datagrid. null when the page has no table. */
export function parseResults(html: string): CourseRow[] | null {
  const table = grids(html)[0];
  return table ? readRows(table, false) : null;
}

/** SupplyCancel.do (api.rs get_supply_cancel): already elected courses, second table.datagrid. */
export function parseElected(html: string): CourseRow[] {
  const table = grids(html)[1];
  return table ? readRows(table, false) : [];
}

/** supplement.jsp page (api.rs parse_supplement_table): first table.datagrid. null when absent. */
export function parseSupplements(html: string): CourseRow[] | null {
  const table = grids(html)[0];
  return table ? readRows(table, true) : null;
}

/**
 * Pager text "Page 1 of 12" in `tr[align='right'] > td` (api.rs parse_total_pages; pkucli's
 * lazy `(\d+?)` would read only the first digit). Defaults to 1.
 */
export function parseTotalPages(html: string): number {
  for (const td of parse(html).querySelectorAll('tr[align="right"] > td')) {
    const n = Number(/Page\s*\d+\s*of\s*(\d+)/.exec(text(td))?.[1]);
    if (n > 0) return n;
  }
  return 1;
}

/** The site's own message (td#msgTips, api.rs elect) or the page title, for "not open now" pages. */
export function parseNotice(html: string): string | null {
  const dom = parse(html);
  const msg = text(dom.querySelector('td#msgTips')) || text(dom.querySelector('#errInfo')) || text(dom.querySelector('title'));
  return msg ? msg.slice(0, 200) : null;
}

export type Quota = { limit: number; elected: number; waitlist: number | null; remaining: number; full: boolean };

/** "限数/已选[/候补]" (api.rs SupplementCourse::is_full: full when elected >= limit). */
export function parseQuota(status: string): Quota | null {
  const parts = status.split('/').map((s) => Number(s.trim()));
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || status.trim() === '') return null;
  const [limit, elected, waitlist] = parts;
  return { limit, elected, waitlist: Number.isFinite(waitlist) ? waitlist : null, remaining: Math.max(limit - elected, 0), full: elected >= limit };
}

/** Visible rows of every table on a page, as trimmed cell texts (empty rows dropped). */
export function tableRows(html: string, limit = 60): string[][] {
  const out: string[][] = [];
  for (const tr of parse(html).querySelectorAll('tr')) {
    if (tr.querySelector('tr')) continue; // layout tables nest rows; keep the innermost
    const cells = tr.querySelectorAll('td, th').map((c) => text(c)).filter(Boolean);
    if (cells.length) out.push(cells);
    if (out.length >= limit) break;
  }
  return out;
}

/** Visible text of a page, whitespace-collapsed (scripts and styles dropped). */
export function pageText(html: string, max = 600): string {
  const dom = parse(html);
  dom.querySelectorAll('script, style').forEach((n) => n.remove());
  return text(dom.querySelector('body') ?? dom).slice(0, max);
}
