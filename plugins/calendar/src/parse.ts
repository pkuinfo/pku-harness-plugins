/**
 * Official PKU school calendar (校历) from simso.pku.edu.cn — pure parsing, unit-tested.
 *
 * Port of pkucli crates/portal/src/calendar.rs. simso is a Vue SPA: the calendar text is
 * compiled into a hashed webpack bundle (`js/ccSchoolCalendar.<hash>.js`). The text nodes
 * (`t._v("…")`) live in each tab's *render function*, which is found through the webpack wiring:
 *   tab `{attrs:{label:"2025-2026学年",name:"2526"}}`
 *   → Home `components:{Calendar2526:<var>}` → `<var>=<mod>.exports`
 *   → `<mod>=(…),Object(o["a"])(<data>,<render>,…)` → `<render>=function(){var t=this,e=t.$createElement…`
 * and split into semesters at `"第一学期"===t.xq?[` / `"第二学期"===t.xq?[`. Internal component
 * `name:`s are reused across years by simso's developers, so never match on them.
 *
 * On top of pkucli (which only prints the lines) this file interprets the lines: semester
 * start date, teaching weeks, holidays and exam weeks. That part is best-effort; the raw lines
 * are always returned so the agent can read them itself.
 */

export type CalendarYear = {
  /** "2025-2026" */
  year: string;
  first: string[];
  second: string[];
};

const ID = '[A-Za-z_$][A-Za-z0-9_$]*';
/** Identifier boundary: `\b` doesn't treat `$` as a word character. */
const B = '(?:^|[^A-Za-z0-9_$])';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `js/ccSchoolCalendar.<hash>.js` from the entry page, or null (simso changed). */
export function bundlePath(html: string): string | null {
  return /(js\/ccSchoolCalendar\.[0-9a-f]+\.js)/.exec(html)?.[1] ?? null;
}

/** Every academic year in the bundle with its semester lines. Throws if nothing was found. */
export function parseBundle(js: string): CalendarYear[] {
  const tabs = new Map<string, string>();
  for (const m of js.matchAll(/\{attrs:\{label:"(\d{4}-\d{4})学年",name:"(\d+)"\}\}/g)) tabs.set(`${m[1]}|${m[2]}`, m[2]);
  if (!tabs.size) throw new Error('校历页面里没找到学年，simso 可能已改版');

  const out: CalendarYear[] = [];
  // pkucli collects tabs into a BTreeSet: sorted by year.
  for (const key of [...tabs.keys()].sort()) {
    const [year, tag] = key.split('|');
    const seg = locateRender(js, tag);
    if (!seg) continue;
    const segment = js.slice(seg[0], seg[1]);
    const s1 = endOf(/"第一学期"===t\.xq\?\[/.exec(segment));
    const s2 = endOf(/"第二学期"===t\.xq\?\[/.exec(segment));
    const firstSlice = s1 == null ? null : s2 != null && s2 > s1 ? segment.slice(s1, s2) : segment.slice(s1);
    const secondSlice = s2 == null ? null : segment.slice(s2);
    const first = firstSlice ? extractText(firstSlice) : [];
    const second = secondSlice ? extractText(secondSlice) : [];
    if (!first.length && !second.length) continue;
    out.push({ year, first, second });
  }
  if (!out.length) throw new Error('解析校历后没有拿到任何学年内容，simso 可能已改版');
  return out;
}

const endOf = (m: RegExpExecArray | null) => (m ? m.index + m[0].length : null);

/** `[start, end)` of the render function bound to a tab tag (see the file comment), or null. */
export function locateRender(js: string, tag: string): [number, number] | null {
  const exportVar = new RegExp(`Calendar${esc(tag)}:(${ID})`).exec(js)?.[1];
  if (!exportVar) return null;
  const modVar = new RegExp(`${B}${esc(exportVar)}=(${ID})\\.exports(?![A-Za-z0-9_$])`).exec(js)?.[1];
  if (!modVar) return null;
  const wrap =
    new RegExp(`${B}${esc(modVar)}=\\([^)]*\\),?\\s*Object\\(o\\["a"\\]\\)\\(\\s*(${ID})\\s*,\\s*(${ID})\\s*,`).exec(js) ??
    // Fallback: webpack output without the leading `(i("…"),…)` comma expression.
    new RegExp(`${B}${esc(modVar)}=Object\\(o\\["a"\\]\\)\\(\\s*(${ID})\\s*,\\s*(${ID})\\s*,`).exec(js);
  const renderVar = wrap?.[2];
  if (!renderVar) return null;
  const startRe = new RegExp(`${B}(${esc(renderVar)}=function\\(\\)\\{var t=this,e=t\\.\\$createElement)`);
  const sm = startRe.exec(js);
  if (!sm) return null;
  const start = sm.index + sm[0].length - sm[1].length;
  // End: the next render function definition (any name), or EOF.
  const next = new RegExp(`${B}${ID}=function\\(\\)\\{var t=this,e=t\\.\\$createElement`, 'g');
  next.lastIndex = start + sm[1].length;
  const nm = next.exec(js);
  return [start, nm ? nm.index : js.length];
}

/** `t._v("…")` text nodes, unescaped, trimmed, empty dropped, consecutive duplicates merged. */
export function extractText(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/t\._v\("((?:\\.|[^"\\])*)"\)/g)) {
    const v = unescapeJs(m[1]).trim();
    if (v && out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

export function unescapeJs(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (all, c: string) => {
    if (c === 'n') return '\n';
    if (c === 't') return '\t';
    if (c === '"' || c === '\\' || c === '/' || c === "'") return c;
    if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    return all;
  });
}

// ── Interpretation ───────────────────────────────────────────────────────────────────────────

export type SemesterKey = 'first' | 'second';

export type DatedItem = { name: string; start: string; end: string; text: string };

export type SemesterInfo = {
  /** "2025-2026学年第一学期" */
  name: string;
  year: string;
  semester: SemesterKey;
  /** First day of teaching week 1 (YYYY-MM-DD), when the calendar says so. */
  start: string | null;
  /** Teaching weeks incl. exam weeks, when derivable. */
  weeks: number | null;
  /** How `weeks` was obtained. */
  weeksFrom: 'stated' | 'exams' | 'end' | null;
  holidays: DatedItem[];
  exams: DatedItem[];
  /** Other dated events (registration, make-up days, course selection…). */
  events: DatedItem[];
  lines: string[];
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const DAY = 86_400_000;
const toMs = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromMs = (ms: number) => {
  const d = new Date(ms);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

/** Calendar year of a month in a semester: first = Aug..Dec of Y, Jan..Feb of Y+1; second = Y+1. */
function yearFor(academic: string, sem: SemesterKey, month: number) {
  const y0 = Number(academic.slice(0, 4));
  if (sem === 'second') return y0 + 1;
  return month >= 7 ? y0 : y0 + 1;
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '十') return 10;
  if (s.startsWith('十')) return 10 + (CN_NUM[s[1]] ?? 0);
  if (s.includes('十')) return (CN_NUM[s[0]] ?? 0) * 10 + (CN_NUM[s[2]] ?? 0);
  return CN_NUM[s] ?? NaN;
}

/**
 * Dates in a line, as [start, end] ranges (single dates have start = end). Understands
 * "2025年9月8日", "9月8日", "9月8日-10月8日", "10月1日至8日", "1月5日—1月18日", "2025.9.8", "9/8".
 */
export function datesIn(line: string, academic: string, sem: SemesterKey): [string, string][] {
  const out: [string, string][] = [];
  const re =
    /(?:(\d{4})\s*[年.\-/])?\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*[日号]?(?:\s*[（(][^）)]*[）)])?(?:\s*(?:-|—|–|~|～|至|到)\s*(?:(\d{4})\s*[年.\-/])?\s*(?:(\d{1,2})\s*[月.\-/])?\s*(\d{1,2})\s*[日号]?)?/g;
  for (const m of line.matchAll(re)) {
    const m1 = Number(m[2]);
    const d1 = Number(m[3]);
    if (m1 < 1 || m1 > 12 || d1 < 1 || d1 > 31) continue;
    const y1 = m[1] ? Number(m[1]) : yearFor(academic, sem, m1);
    const start = iso(y1, m1, d1);
    let end = start;
    if (m[6]) {
      const m2 = m[5] ? Number(m[5]) : m1;
      const d2 = Number(m[6]);
      if (m2 >= 1 && m2 <= 12 && d2 >= 1 && d2 <= 31) {
        let y2 = m[4] ? Number(m[4]) : m[1] && !m[5] ? y1 : yearFor(academic, sem, m2);
        if (toMs(iso(y2, m2, d2)) < toMs(start)) y2 = y1 + 1;
        end = iso(y2, m2, d2);
      }
    }
    out.push([start, end]);
  }
  return out;
}

/** Monday on or before a date. */
export function mondayOf(date: string) {
  const ms = toMs(date);
  const wd = new Date(ms).getUTCDay();
  return fromMs(ms - ((wd + 6) % 7) * DAY);
}

const weekNo = (start: string, date: string) => Math.floor((toMs(date) - toMs(mondayOf(start))) / DAY / 7) + 1;

const HOLIDAY = /放假|假期|休假|调休|国庆|元旦|春节|清明|劳动节|端午|中秋|寒假|暑假/;
const EXAM = /考试/;
const START = /(?:开始|正式)?上课|开课|开学/;
const NOT_START = /停课|补课|调课|结束|截止|放假|考试|报名|选课/;

/**
 * Interpret one semester's lines. Lines are text nodes and may be split across nodes (e.g. a
 * date cell then its event cell), so each line is also read together with its neighbour.
 */
export function interpretSemester(year: string, semester: SemesterKey, lines: string[]): SemesterInfo {
  const name = `${year}学年${semester === 'first' ? '第一' : '第二'}学期`;
  const items: { text: string; dates: [string, string][] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i];
    let dates = datesIn(text, year, semester);
    // A bare date/range node followed by its description node, or a description then its date.
    if (dates.length && text.replace(/[\d\s年月日号.\-/—–~～至到（）()星期周一二三四五六日天]/g, '').length === 0 && lines[i + 1]) {
      text = `${text} ${lines[i + 1]}`;
      i++;
    } else if (!dates.length && lines[i + 1] && /^[\d\s年月日号.\-/—–~～至到（）()星期周一二三四五六日天]+$/.test(lines[i + 1])) {
      const next = datesIn(lines[i + 1], year, semester);
      if (next.length) {
        text = `${text} ${lines[i + 1]}`;
        dates = next;
        i++;
      }
    }
    if (dates.length) items.push({ text, dates });
  }

  // Start: the "上课/开学" line; else the Monday after registration (报到/注册).
  let start: string | null = null;
  const startItem = items.find((it) => START.test(it.text) && !NOT_START.test(it.text));
  if (startItem) start = startItem.dates[0][0];
  else {
    const reg = items.find((it) => /报到|注册/.test(it.text));
    if (reg) {
      const d = reg.dates[0][1];
      const mon = mondayOf(d);
      start = mon === d ? d : fromMs(toMs(mon) + 7 * DAY);
    }
  }

  const holidays: DatedItem[] = [];
  const exams: DatedItem[] = [];
  const events: DatedItem[] = [];
  for (const it of items) {
    // Several separate dates in one line ("10月1日、10月8日"): span them all.
    const s = it.dates[0][0];
    const end = it.dates.reduce((a, d) => (d[1] > a ? d[1] : a), it.dates[0][1]);
    const item = { name: label(it.text), start: s, end, text: it.text };
    if (EXAM.test(it.text)) exams.push(item);
    else if (HOLIDAY.test(it.text)) holidays.push(item);
    else if (it !== startItem) events.push(item);
  }

  // Weeks: stated ("共18周", "第1-18周"), else the week of the last exam day, else the week
  // before "学期结束 / 寒假 / 暑假".
  let weeks: number | null = null;
  let weeksFrom: SemesterInfo['weeksFrom'] = null;
  const all = lines.join(' ');
  const stated = /共\s*([0-9一二三四五六七八九十]+)\s*(?:个)?(?:教学)?周/.exec(all) ?? /第\s*1\s*[-—–~至到]\s*(\d{1,2})\s*周/.exec(all);
  if (stated) {
    const n = cnNumber(stated[1]);
    if (n >= 1 && n <= 30) {
      weeks = n;
      weeksFrom = 'stated';
    }
  }
  if (weeks == null && start && exams.length) {
    const last = exams.reduce((a, b) => (b.end > a ? b.end : a), exams[0].end);
    const n = weekNo(start, last);
    if (n >= 1 && n <= 30) {
      weeks = n;
      weeksFrom = 'exams';
    }
  }
  if (weeks == null && start) {
    const endItem = items.find((it) => /学期结束|寒假|暑假/.test(it.text) && it.dates[0][0] > start!);
    if (endItem) {
      const n = weekNo(start, fromMs(toMs(endItem.dates[0][0]) - DAY));
      if (n >= 1 && n <= 30) {
        weeks = n;
        weeksFrom = 'end';
      }
    }
  }

  return { name, year, semester, start, weeks, weeksFrom, holidays, exams, events, lines };
}

/** Event name without its dates: "国庆节放假：10月1日-10月8日" → "国庆节放假". */
function label(text: string) {
  const s = text
    .replace(/(?:\d{4}\s*[年.\-/])?\s*\d{1,2}\s*[月.\-/]\s*\d{1,2}\s*[日号]?/g, ' ')
    .replace(/[（(]\s*(?:星期|周)[一二三四五六日天]\s*[）)]/g, ' ')
    .replace(/(?:-|—|–|~|～|至|到)\s*\d{1,2}\s*[日号]/g, ' ')
    .replace(/[：:，,;；。、\-—–~～]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || text;
}

/** Every semester in the calendar, interpreted. */
export function semesters(years: CalendarYear[]): SemesterInfo[] {
  return years.flatMap((y) => [
    ...(y.first.length ? [interpretSemester(y.year, 'first', y.first)] : []),
    ...(y.second.length ? [interpretSemester(y.year, 'second', y.second)] : []),
  ]);
}

/**
 * The semester to use on `today` (YYYY-MM-DD): the one in progress, else the next to start
 * within 60 days, else the most recent that has started. Only semesters with a start date.
 */
export function currentSemester(list: SemesterInfo[], today: string): SemesterInfo | null {
  const dated = list.filter((s) => s.start).sort((a, b) => a.start!.localeCompare(b.start!));
  if (!dated.length) return null;
  const t = toMs(today);
  // Unknown length: assume 20 weeks, PKU semesters are 16–18 incl. exams.
  const running = dated.filter((s) => toMs(s.start!) <= t && t < toMs(mondayOf(s.start!)) + (s.weeks ?? 20) * 7 * DAY);
  if (running.length) return running[running.length - 1];
  const upcoming = dated.find((s) => toMs(s.start!) > t && toMs(s.start!) - t <= 60 * DAY);
  if (upcoming) return upcoming;
  const past = dated.filter((s) => toMs(s.start!) <= t);
  return past[past.length - 1] ?? dated[0];
}
