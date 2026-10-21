import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Pure parsers (fixtures in ./fixtures, captured 2026-10-21):
 * - crowd: portal.pku.edu.cn/publicQuery/canteenQuery/retrCarteenInfos.do (public, what the
 *   portal's 食堂就餐人数 chart polls every minute: CanteenController.js) →
 *   `{time, rows: [{name, seat, ip, warningMsg}]}` with ip = people dining now, seat = seats.
 * - hours: 餐饮中心「食堂开闭餐时间」table (cyzx.pku.edu.cn/fwzn/74317312….htm), rowspan/colspan
 *   layout: 食堂 | 区域 | 早餐 | 午餐 | 晚餐; a cell spanning meals = continuous opening.
 * - notices: 餐饮中心「通知公告」list (closures, holiday arrangements).
 */

// ── Crowd ──

export type RawCrowd = { time?: string; rows?: { name?: string; seat?: number | string; ip?: number | string; warningMsg?: string | null }[] };

export type CrowdLevel = '空闲' | '适中' | '较挤' | '拥挤';

export type Crowd = { name: string; diners: number; seats: number; percent: number; level: CrowdLevel; warning?: string };

export function level(percent: number): CrowdLevel {
  if (percent < 30) return '空闲';
  if (percent < 60) return '适中';
  if (percent < 90) return '较挤';
  return '拥挤';
}

export function parseCrowd(json: string): { time: string | null; canteens: Crowd[] } {
  let raw: RawCrowd;
  try {
    raw = JSON.parse(json) as RawCrowd;
  } catch {
    throw new Error('食堂人数接口返回了无法解析的内容');
  }
  if (!Array.isArray(raw.rows)) throw new Error('食堂人数接口没有返回数据');
  const canteens = raw.rows
    .map((r) => {
      const seats = Number(r.seat) || 0;
      const diners = Math.max(0, Number(r.ip) || 0);
      const percent = seats > 0 ? Math.round((diners / seats) * 100) : 0;
      const warning = (r.warningMsg ?? '').trim();
      return { name: (r.name ?? '').trim(), diners, seats, percent, level: level(percent), ...(warning ? { warning } : {}) };
    })
    .filter((c) => c.name);
  return { time: raw.time?.trim() || null, canteens };
}

// ── Opening hours ──

export type Meal = 'breakfast' | 'lunch' | 'dinner';
export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner'];
export const MEAL_NAMES: Record<Meal, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };

export type Venue = {
  canteen: string;
  /** Floor / counter within the canteen, when the table splits it. */
  area: string | null;
  /** Text as published ("6:50-8:30 （值班餐至9:00）"); null = not served. */
  meals: Record<Meal, string | null>;
  /** Meals covered by one continuous opening (a cell spanning several meal columns). */
  continuous?: Meal[][];
  notes?: string[];
};

const squash = (s: string) => s.replace(/[\s 　]+/g, ' ').replace(/\s*（\s*/g, '（').replace(/\s*）/g, '）').trim();

type Cell = { text: string; id: number };

/** Expand a table with rowspan/colspan into a rectangular grid of cell references. */
export function grid(table: HTMLElement): Cell[][] {
  const rows: Cell[][] = [];
  let id = 0;
  table.querySelectorAll('tr').forEach((tr, r) => {
    rows[r] ??= [];
    let c = 0;
    for (const td of tr.querySelectorAll('td, th')) {
      while (rows[r][c]) c++;
      const cell = { text: squash(td.text), id: id++ };
      const rs = Math.max(1, Number(td.getAttribute('rowspan')) || 1);
      const cs = Math.max(1, Number(td.getAttribute('colspan')) || 1);
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) (rows[r + dr] ??= [])[c + dc] = cell;
      c += cs;
    }
  });
  return rows;
}

const TIME_RANGE = /(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})/;

/** Parse the 餐饮中心 table. Notes rows (one cell across all meals, no times) attach to the canteen. */
export function parseHours(html: string): { updated: string | null; venues: Venue[] } {
  const root = parse(html);
  const updated = /日期[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(root.text)?.[1] ?? null;
  const table = root.querySelectorAll('table').find((t) => /食堂名称/.test(t.text) && /早餐/.test(t.text));
  if (!table) throw new Error('餐饮中心页面里没找到开闭餐时间表，网站可能已改版');
  const venues: Venue[] = [];
  let lastIds: Record<Meal, number> | null = null;
  for (const row of grid(table).slice(1)) {
    if (!row || row.length < 5 || !row[0]?.text) continue;
    const canteen = row[0].text;
    const area = row[1] && row[1].id !== row[0].id ? row[1].text : null;
    const cells = row.slice(2, 5);
    if (cells.length < 3 || cells.some((c) => !c)) continue;
    const prev = venues.at(-1);
    // A notes row: one cell over all three meals that is not a time ("值班餐均在中厅档口开放…").
    if (cells[0].id === cells[1].id && cells[1].id === cells[2].id && !TIME_RANGE.test(cells[0].text)) {
      if (prev && prev.canteen === canteen) (prev.notes ??= []).push(cells[0].text);
      continue;
    }
    // 佟园: the breakfast cell spans two rows, the second row's other cells are a note.
    if (prev && prev.canteen === canteen && area === null && cells[1].id === cells[2].id && cells[0].id === lastIds?.breakfast) {
      (prev.notes ??= []).push(cells[1].text);
      continue;
    }
    const meals = {} as Record<Meal, string | null>;
    const ids = {} as Record<Meal, number>;
    MEALS.forEach((m, k) => {
      const t = cells[k].text;
      meals[m] = !t || t === '/' ? null : t;
      ids[m] = cells[k].id;
    });
    const continuous: Meal[][] = [];
    for (let k = 0; k < 3; ) {
      let e = k;
      while (e + 1 < 3 && cells[e + 1].id === cells[k].id) e++;
      if (e > k && meals[MEALS[k]]) continuous.push(MEALS.slice(k, e + 1));
      k = e + 1;
    }
    const v: Venue = { canteen, area, meals, ...(continuous.length ? { continuous } : {}) };
    lastIds = ids;
    venues.push(v);
  }
  if (!venues.length) throw new Error('开闭餐时间表是空的，网站可能已改版');
  return { updated, venues };
}

/** Minutes after midnight of the first opening range in a meal text, with "值班餐至 HH:mm" extending the close. */
export function mealRange(text: string | null): { open: number; close: number } | null {
  if (!text) return null;
  const m = TIME_RANGE.exec(text);
  if (!m) return null;
  const open = Number(m[1]) * 60 + Number(m[2]);
  let close = Number(m[3]) * 60 + Number(m[4]);
  if (close === 0) close = 24 * 60; // "17:00-24:00"
  const ext = /值班餐至\s*(\d{1,2}):(\d{2})/.exec(text);
  if (ext) close = Math.max(close, Number(ext[1]) * 60 + Number(ext[2]));
  return { open, close };
}

export type OpenState = { canteen: string; area: string | null; hours: string; closesInMinutes: number };

/** Venues open at `minutes` after midnight (weekday hours; weekend exceptions are in the notes). */
export function openAt(venues: Venue[], minutes: number): OpenState[] {
  const out: OpenState[] = [];
  for (const v of venues) {
    for (const meal of MEALS) {
      const r = mealRange(v.meals[meal]);
      if (r && minutes >= r.open && minutes < r.close) {
        out.push({ canteen: v.canteen, area: v.area, hours: v.meals[meal]!, closesInMinutes: r.close - minutes });
        break;
      }
    }
  }
  return out;
}

// ── 餐饮中心 notices ──

export type CanteenNotice = { title: string; date: string; url: string };

/** `<span class="gpArticleDate">2026-09-28</span><a href="….htm">标题</a>` items of the 通知公告 list. */
export function parseCanteenNotices(html: string, pageUrl: string): CanteenNotice[] {
  const root = parse(html);
  const out: CanteenNotice[] = [];
  for (const li of root.querySelectorAll('li')) {
    const date = li.querySelector('.gpArticleDate')?.text.trim();
    const a = li.querySelector('a.gpArticleTitle') ?? li.querySelector('a');
    const href = a?.getAttribute('href');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !a || !href) continue;
    out.push({ title: squash(a.text), date, url: new URL(href, pageUrl).toString() });
  }
  return out;
}

/** Beijing wall clock (UTC+8) of a timestamp: date, weekday (0 = Sunday), minutes after midnight. */
export function beijing(ms: number) {
  const d = new Date(ms + 8 * 3_600_000);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), time: d.toISOString().slice(11, 16) };
}
