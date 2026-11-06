/**
 * Money and calendar helpers. Sums run in integer fen so 0.1 + 0.2 stays 0.30; months and days
 * are wall-clock time in the app's clock zone (SDK `clock.ts`: the phone's zone, or the fixed one
 * chosen in Settings), so a 23:30 dinner counts on that day, not on UTC's.
 */

import { addDays, at, dayKey as clockDayKey, daysInMonth as clockDaysInMonth, parts } from '@pku-harness/sdk';

/** Yuan → integer fen (rounds half away from zero at the third decimal). */
export const toFen = (yuan: number) => Math.round((Math.abs(yuan) + Number.EPSILON) * 100) * Math.sign(yuan || 0) || 0;
/** Integer fen → yuan. */
export const toYuan = (fen: number) => Math.round(fen) / 100;
/** Round an amount to two decimals through fen. */
export const round2 = (yuan: number) => toYuan(toFen(yuan));
/** Sum yuan amounts exactly. */
export const sumYuan = (values: number[]) => toYuan(values.reduce((s, v) => s + toFen(v), 0));

/** "18.00", "1,234.50". */
export function formatMoney(yuan: number, decimals = 2): string {
  const [int, frac] = Math.abs(yuan).toFixed(decimals).split('.');
  return `${yuan < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM" of a local time. */
export const monthKey = (t: number | Date) => {
  const d = parts(+t);
  return `${d.year}-${pad(d.month)}`;
};
/** "YYYY-MM-DD" of a local time. */
export const dayKey = (t: number | Date) => clockDayKey(+t);

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Local midnight that starts "YYYY-MM-DD". */
export function parseDay(day: string): number {
  if (!DAY_RE.test(day)) throw new Error(`日期格式错误：${day}（应为 YYYY-MM-DD）`);
  const [y, m, d] = day.split('-').map(Number);
  if (d > clockDaysInMonth(y, m)) throw new Error(`没有这一天：${day}`);
  return at(y, m, d);
}

/**
 * A time the model or a form gave: "YYYY-MM-DD" (noon that day, so it sorts after breakfast
 * entries without a time), "YYYY-MM-DD HH:mm", or an ISO string / ms number.
 */
export function parseWhen(value: string | number, now = Date.now()): number {
  if (typeof value === 'number') return value;
  const v = value.trim();
  if (DAY_RE.test(v)) {
    const start = parseDay(v);
    // Today without a time = now; another day = 12:00 there.
    return dayKey(now) === v ? now : start + 12 * 3600_000;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v);
  if (m) {
    const [h, min] = [Number(m[2]), Number(m[3])];
    if (h > 23 || min > 59) throw new Error(`时间格式错误：${value}`);
    return parseDay(m[1]) + h * 3600_000 + min * 60_000;
  }
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error(`时间格式错误：${value}（用 YYYY-MM-DD 或 YYYY-MM-DD HH:mm）`);
  return t;
}

/** [start, end) of a local month. */
export function monthBounds(month: string): { start: number; end: number } {
  if (!MONTH_RE.test(month)) throw new Error(`月份格式错误：${month}（应为 YYYY-MM）`);
  const [y, m] = month.split('-').map(Number);
  return { start: at(y, m, 1), end: at(y, m + 1, 1) };
}

export const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return clockDaysInMonth(y, m);
};

/** "YYYY-MM" shifted by n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${pad((((k % 12) + 12) % 12) + 1)}`;
}

/** Month keys from `from` to `to` inclusive (either order). */
export function monthsBetween(from: string, to: string): string[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const out: string[] = [];
  for (let k = a; k <= b; k = addMonths(k, 1)) out.push(k);
  return out;
}

/** Month keys a [start, end) range touches. */
export const monthsOfRange = (start: number, end: number) => monthsBetween(monthKey(start), monthKey(Math.max(start, end - 1)));

export type PeriodName = 'today' | 'week' | 'month' | 'last-month' | 'year' | 'last-year' | 'custom';

export interface Range {
  /** Inclusive start, ms. */
  start: number;
  /** Exclusive end, ms (never past the end of the period). */
  end: number;
  /** "2026-11", "2026", "2026-11-01~2026-11-05" */
  label: string;
  unit: 'day' | 'month';
}

/**
 * A named period in local time. `month` (YYYY-MM) and `year` pick another month / year for
 * 'month' / 'year'; 'custom' needs from/to days (inclusive). Weeks start on Monday.
 */
export function resolvePeriod(p: { period?: PeriodName; month?: string; year?: number; from?: string; to?: string }, now = Date.now()): Range {
  const d = parts(now);
  const period = p.period ?? (p.from || p.to ? 'custom' : p.year && !p.month ? 'year' : 'month');
  switch (period) {
    case 'today': {
      const start = at(d.year, d.month, d.day);
      return { start, end: at(d.year, d.month, d.day + 1), label: dayKey(start), unit: 'day' };
    }
    case 'week': {
      const back = d.weekday - 1;
      const start = at(d.year, d.month, d.day - back);
      const end = at(d.year, d.month, d.day - back + 7);
      return { start, end, label: `${dayKey(start)}~${dayKey(end - 1)}`, unit: 'day' };
    }
    case 'month':
    case 'last-month': {
      const month = period === 'last-month' ? addMonths(monthKey(now), -1) : (p.month ?? monthKey(now));
      return { ...monthBounds(month), label: month, unit: 'day' };
    }
    case 'year':
    case 'last-year': {
      const y = period === 'last-year' ? d.year - 1 : (p.year ?? d.year);
      return { start: at(y, 1, 1), end: at(y + 1, 1, 1), label: String(y), unit: 'month' };
    }
    case 'custom': {
      const from = p.from ?? p.to;
      const to = p.to ?? p.from;
      if (!from || !to) throw new Error('自定义时间段需要 from / to（YYYY-MM-DD）');
      const [a, b] = from <= to ? [from, to] : [to, from];
      const start = parseDay(a);
      const end = addDays(parseDay(b), 1);
      // Short ranges chart by day; longer than about two months by month.
      return { start, end, label: `${a}~${b}`, unit: end - start > 62 * 86_400_000 ? 'month' : 'day' };
    }
  }
}

/** The same-length period right before (previous month / year / span), for comparisons. */
export function previousRange(r: Range): Range {
  const s = parts(r.start);
  const e = parts(r.end);
  // Whole months / years shift by calendar, so February compares with all of January.
  const wholeMonths = s.day === 1 && e.day === 1 && s.hour === 0 && e.hour === 0;
  if (wholeMonths) {
    const months = (e.year - s.year) * 12 + e.month - s.month;
    const start = at(s.year, s.month - months, 1);
    const label = months === 12 ? String(s.year - 1) : months === 1 ? monthKey(start) : `${dayKey(start)}~${dayKey(r.start - 1)}`;
    return { start, end: r.start, label, unit: r.unit };
  }
  const len = r.end - r.start;
  return { start: r.start - len, end: r.start, label: `${dayKey(r.start - len)}~${dayKey(r.start - 1)}`, unit: r.unit };
}

/** Bucket keys for a chart over the range: every day ("YYYY-MM-DD") or month ("YYYY-MM"). */
export function bucketKeys(r: Range): string[] {
  if (r.unit === 'month') return monthsOfRange(r.start, r.end);
  const out: string[] = [];
  for (let t = r.start; t < r.end; t = addDays(t, 1)) out.push(dayKey(t));
  return out;
}
