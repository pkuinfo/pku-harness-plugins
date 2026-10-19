import { parse } from 'node-html-parser';

/**
 * PKU course catalog parsing, ported from pkucli crates/claspider:
 * - dean.rs: 教务部课表查询 (dean.pku.edu.cn, public JSON, 10 rows per page, no classroom)
 * - elective_query.rs: 选课网「添加其它课程」query (elective.pku.edu.cn HTML, has classrooms)
 * - model.rs: the unified course record
 * Pure: response text in, data out.
 */

/** PKU's standard period times (本科生作息), as in course-sync's DEFAULT_PERIODS. */
export const PERIODS: Record<number, [string, string]> = {
  1: ['08:00', '08:50'],
  2: ['09:00', '09:50'],
  3: ['10:10', '11:00'],
  4: ['11:10', '12:00'],
  5: ['13:00', '13:50'],
  6: ['14:00', '14:50'],
  7: ['15:10', '16:00'],
  8: ['16:10', '17:00'],
  9: ['17:10', '18:00'],
  10: ['18:40', '19:30'],
  11: ['19:40', '20:30'],
  12: ['20:40', '21:30'],
};

/** One weekly meeting. Weekday uses JS numbering (0 = Sunday … 6 = Saturday), like the SDK timetable. */
export type Session = {
  weekday: number;
  periods: [number, number];
  start: string | null;
  end: string | null;
  /** "1-15", when known */
  weeks: string | null;
  weekType: 'every' | 'odd' | 'even';
  room: string | null;
};

/** model.rs CourseInfo. */
export type CatalogCourse = {
  courseId: string;
  name: string;
  /** 专业必修 / 专业限选 / 全校任选 … */
  category: string;
  classNo: string;
  credit: string;
  teacher: string;
  department: string;
  /** Original schedule text. */
  schedule: string;
  sessions: Session[];
  /** Rooms joined with ", "; empty from the dean source. */
  classroom: string;
  weeks: string;
  remark: string;
  source: 'dean' | 'elective';
};

const CN_DAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
const WEEK_TYPE: Record<string, Session['weekType']> = { 每周: 'every', 单周: 'odd', 双周: 'even' };

function session(day: string, a: number, b: number, weeks: string | null, type: string | undefined, room: string | null): Session {
  const [p1, p2] = a <= b ? [a, b] : [b, a];
  return { weekday: CN_DAY[day], periods: [p1, p2], start: PERIODS[p1]?.[0] ?? null, end: PERIODS[p2]?.[1] ?? null, weeks, weekType: WEEK_TYPE[type ?? ''] ?? 'every', room };
}

/** dean.rs strip_html: tags → spaces, whitespace collapsed. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 教务部 (dean.rs) ───────────────────────────────────────────────────────────────────────────

/** dean.rs DeanCourse (the JSON fields we use). */
type DeanCourse = { kch?: string; kcmc?: string; kctxm?: string; kkxsmc?: string; jxbh?: string; xf?: string; qzz?: string; sksj?: string; teacher?: string; bz?: string };

/**
 * Dean schedule text, e.g. "<p>星期二(第3节-第4节)</p><p>星期四(第1节-第2节)(单周)</p>".
 * Weeks come from the separate 起止周 field.
 */
export function parseDeanSchedule(sksj: string, weeks: string | null = null): Session[] {
  const text = stripHtml(sksj);
  const re = /星期([一二三四五六日天])\s*[（(]?\s*第\s*(\d{1,2})\s*节\s*(?:[-~—至]\s*第?\s*(\d{1,2})\s*节)?\s*[)）]?\s*(?:[（(]?\s*(每周|单周|双周)\s*[)）]?)?/g;
  return [...text.matchAll(re)].map((m) => session(m[1], Number(m[2]), Number(m[3] ?? m[2]), weeks, m[4], null));
}

/** One page of `courseSearch_do.php`. Throws on a non-"ok" status (dean.rs fetch_page). */
export function parseDeanResponse(text: string): { count: number; courses: CatalogCourse[] } {
  let data: { status?: string; count?: string | number; courselist?: DeanCourse[] };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('教务部返回的不是课程数据，网站可能在维护');
  }
  if (data.status !== 'ok') throw new Error(`教务部返回错误：${data.status ?? '未知'}`);
  const courses = (data.courselist ?? []).map((c): CatalogCourse => {
    const weeks = (c.qzz ?? '').trim();
    return {
      courseId: c.kch ?? '',
      name: c.kcmc ?? '',
      category: c.kctxm ?? '',
      classNo: c.jxbh ?? '',
      credit: c.xf ?? '',
      teacher: stripHtml(c.teacher ?? ''),
      department: c.kkxsmc ?? '',
      schedule: stripHtml(c.sksj ?? ''),
      sessions: parseDeanSchedule(c.sksj ?? '', weeks || null),
      // dean.rs extract_classroom_from_remark: rooms aren't in the dean data.
      classroom: '',
      weeks,
      remark: stripHtml(c.bz ?? ''),
      source: 'dean',
    };
  });
  return { count: Number(data.count) || 0, courses };
}

/**
 * `<select>` options on the dean search page (院系 `yuanxi`, 学期 `yearandseme`), matched by the
 * select's name or id. Skips the "全部" (0) choice.
 */
export function parseSelectOptions(html: string, name: string): { value: string; label: string }[] {
  const root = parse(html);
  const select = root.querySelectorAll('select').find((s) => s.getAttribute('name') === name || s.getAttribute('id') === name);
  if (!select) return [];
  return select
    .querySelectorAll('option')
    .map((o) => ({ value: (o.getAttribute('value') ?? '').trim(), label: o.text.trim() }))
    .filter((o) => o.value && o.value !== '0' && o.label);
}

/** Dean semester code ("25-26-1") for a date: Aug–Jan = first semester, Feb–Jul = second. */
export function semesterCode(date: Date): string {
  const y = date.getFullYear() % 100;
  const m = date.getMonth() + 1;
  const yy = (n: number) => String((n + 100) % 100).padStart(2, '0');
  if (m >= 8) return `${yy(y)}-${yy(y + 1)}-1`;
  if (m === 1) return `${yy(y - 1)}-${yy(y)}-1`;
  return `${yy(y - 1)}-${yy(y)}-2`;
}

// ── 选课网 (elective_query.rs) ─────────────────────────────────────────────────────────────────

/**
 * elective_query.rs parse_time_and_room. Examples:
 * - "1~15周 每周周二5~6节 理教310"
 * - "1~15周 双周周一1~2节 理教309考试方式：堂考"
 * - "1~15周 每周周三1~2节 三教2011~15周 每周周一3~4节 三教201" (room glued to the next weeks)
 */
export function parseTimeAndRoom(input: string): { schedule: string; classroom: string; weeks: string; sessions: Session[] } {
  if (!input) return { schedule: '', classroom: '', weeks: '', sessions: [] };
  // A room number glued to the next "N~M周": split them (3+ digit room, 1–2 digit week).
  const raw = input.replace(/(\d{3,}?)(\d{1,2}~\d{1,2}周)/g, '$1 $2');
  const re = /(\d{1,2})~(\d{1,2})周\s*((?:每周|单周|双周)?)周([一二三四五六日])(\d{1,2})~(\d{1,2})节/g;
  const slots = [...raw.matchAll(re)].map((m) => ({ m, start: m.index!, end: m.index! + m[0].length }));
  if (!slots.length) return { schedule: raw, classroom: '', weeks: '', sessions: [] };

  const sessions: Session[] = [];
  const rooms: string[] = [];
  slots.forEach((slot, i) => {
    const roomRaw = raw.slice(slot.end, i + 1 < slots.length ? slots[i + 1].start : raw.length);
    const room = roomRaw.split('考试')[0].split('(备注')[0].split('（备注')[0].trim();
    const m = slot.m;
    sessions.push(session(m[4], Number(m[5]), Number(m[6]), `${m[1]}-${m[2]}`, m[3] || undefined, room || null));
    // Vec::dedup: consecutive duplicates only.
    if (room && rooms[rooms.length - 1] !== room) rooms.push(room);
  });
  return {
    schedule: slots.map((s) => s.m[0]).join('; '),
    classroom: rooms.join(', '),
    weeks: `${slots[0].m[1]}~${slots[0].m[2]}周`,
    sessions,
  };
}

/** elective_query.rs parse_total_pages: "Page 1 of 7" in the page text. */
export function parseTotalPages(text: string): number {
  const m = /Page\s*\d+\s*of\s*(\d+)/.exec(text);
  return m ? Number(m[1]) || 1 : 1;
}

/**
 * elective_query.rs parse_course_table: `table.datagrid`, header row skipped, rows with < 10
 * cells (pager) skipped. Columns: 课程号 课程名 类别 学分 教师 班号 开课单位 专业 年级
 * 上课时间及教室 限数/已选 自选P/NP 备注 …
 */
export function parseElectiveTable(html: string): { courses: CatalogCourse[]; totalPages: number } {
  const root = parse(html);
  const table = root.querySelector('table.datagrid');
  if (!table) {
    if (/尚未登录|会话超时|请重新登录/.test(html)) throw new Error('选课网会话已失效，请稍后重试');
    throw new Error('选课网没有返回课程查询结果（可能不在选课开放时间）');
  }
  const courses: CatalogCourse[] = [];
  for (const row of table.querySelectorAll('tr').slice(1)) {
    const cells = row.querySelectorAll('td').map((td) => td.text.replace(/ /g, ' ').trim());
    if (cells.length < 10) continue;
    const t = parseTimeAndRoom(cells[9] ?? '');
    courses.push({
      courseId: cells[0],
      name: cells[1],
      category: cells[2],
      classNo: cells[5] ?? '',
      credit: cells[3] ?? '',
      teacher: cells[4] ?? '',
      department: cells[6] ?? '',
      schedule: t.schedule,
      sessions: t.sessions,
      classroom: t.classroom,
      weeks: t.weeks,
      remark: cells[12] ?? '',
      source: 'elective',
    });
  }
  return { courses, totalPages: parseTotalPages(root.text) };
}
