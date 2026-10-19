import { parseWeeks } from '@pku-harness/sdk';

/**
 * Parsing for treehole `/chapi/api/getCoursetable_v2` (pkucli crates/treehole/src/api.rs
 * `get_coursetable`): `data.course` is one row per period (`timeNum` "第一节" …), each with
 * `mon`…`sun` = `{ courseName, sty }`, where courseName is
 * "Name<br>上课信息：…<br>考试信息：…". Consecutive periods of one course merge into a meeting.
 */

export type RawRow = { timeNum?: string } & Partial<Record<(typeof DAYS)[number], { courseName?: string; sty?: string } | null>>;

export type Meeting = {
  name: string;
  /** JS weekday: 0 = Sunday … 6 = Saturday. */
  weekday: number;
  firstPeriod: number;
  lastPeriod: number;
  /** "上课信息" text with tags stripped, as the server wrote it. */
  info: string | null;
  weeks: number[] | null;
};

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const JS_DAY = [1, 2, 3, 4, 5, 6, 0];
const DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** "第一节" / "第十二节" / "3" → period number. */
export function periodOf(label: string): number | null {
  const s = label.replace(/[第节\s]/g, '');
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '十') return 10;
  const m = /^(?:([一二三四五六七八九])?十)?([一二三四五六七八九])?$/.exec(s);
  if (!m || !s) return null;
  const tens = s.includes('十') ? (m[1] ? DIGIT[m[1]] : 1) : 0;
  return tens * 10 + (m[2] ? DIGIT[m[2]] : 0) || null;
}

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Teaching weeks from text like "1-16周", "1-15周(单)", "2-16周双"; null when absent. */
export function weeksOf(info: string | null, total = 20): number[] | null {
  if (!info) return null;
  const m = /(\d+)\s*-\s*(\d+)\s*周\s*[(（]?\s*([单双])?/.exec(info);
  if (!m) return null;
  try {
    return parseWeeks(`${m[1]}-${m[2]}${m[3] ?? ''}`, total);
  } catch {
    return null;
  }
}

function cell(raw: string) {
  const parts = raw.split(/<br\s*\/?>/i);
  const name = strip(parts[0] ?? '');
  const infoPart = parts.map(strip).find((p) => p.startsWith('上课信息'));
  const info = infoPart ? infoPart.replace(/^上课信息[:：]\s*/, '') || null : null;
  return { name, info };
}

export function parseCourseTable(rows: RawRow[], totalWeeks = 20): Meeting[] {
  const out: Meeting[] = [];
  DAYS.forEach((day, d) => {
    let open: Meeting | null = null;
    rows.forEach((row, i) => {
      const period = periodOf(row.timeNum ?? '') ?? i + 1;
      const raw = row[day]?.courseName ?? '';
      const c = raw ? cell(raw) : null;
      if (open && c && c.name === open.name && open.lastPeriod === period - 1) {
        open.lastPeriod = period;
        return;
      }
      if (open) out.push(open);
      open = c?.name ? { name: c.name, weekday: JS_DAY[d], firstPeriod: period, lastPeriod: period, info: c.info, weeks: weeksOf(c.info, totalWeeks) } : null;
    });
    if (open) out.push(open);
  });
  return out;
}

/**
 * PKU's standard period times (本科生作息). Used when `classtimes/user_class_times` is missing
 * or unparsable.
 */
export const DEFAULT_PERIODS: Record<number, [string, string]> = {
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

const pad = (t: string) => (t.length === 4 ? `0${t}` : t);

/** `[{ name: "第一节", time_period: "08:00-08:50" }]` → period → [start, end], over the defaults. */
export function periodTimes(list: { name?: string; time_period?: string }[] | undefined): Record<number, [string, string]> {
  const out = { ...DEFAULT_PERIODS };
  for (const t of list ?? []) {
    const p = periodOf(t.name ?? '');
    const m = /(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/.exec(t.time_period ?? '');
    if (p && m) out[p] = [pad(m[1]), pad(m[2])];
  }
  return out;
}
