import { categoryName, OTHER, type Category, type Entry, type EntryType, type Settings } from './model';
import { bucketKeys, dayKey, daysInMonth, monthBounds, monthKey, toFen, toYuan, type Range } from './time';

/** Pure aggregation over entries (no kv): what the tools, screens and widgets all show. */

type Locale = 'zh-Hans' | 'en';

export interface Totals {
  income: number;
  expense: number;
  net: number;
  count: number;
}

export function inRange(entries: Entry[], r: { start: number; end: number }): Entry[] {
  return entries.filter((e) => e.at >= r.start && e.at < r.end);
}

export function totals(entries: Entry[]): Totals {
  let income = 0;
  let expense = 0;
  for (const e of entries) {
    if (e.type === 'income') income += toFen(e.amount);
    else expense += toFen(e.amount);
  }
  return { income: toYuan(income), expense: toYuan(expense), net: toYuan(income - expense), count: entries.length };
}

export interface CategoryShare {
  category: string;
  name: string;
  icon: string;
  amount: number;
  /** Of this type's total, 0..1 (3 decimals). */
  share: number;
  count: number;
}

/** Amount per category of one type, largest first. Unknown category ids count as 其他. */
export function byCategory(entries: Entry[], type: EntryType, categories: Category[], locale: Locale = 'zh-Hans'): CategoryShare[] {
  const known = new Map(categories.map((c) => [c.id, c]));
  const sums = new Map<string, { fen: number; count: number }>();
  let all = 0;
  for (const e of entries) {
    if (e.type !== type) continue;
    const id = known.has(e.category) ? e.category : OTHER[type];
    const s = sums.get(id) ?? { fen: 0, count: 0 };
    s.fen += toFen(e.amount);
    s.count++;
    sums.set(id, s);
    all += toFen(e.amount);
  }
  return [...sums.entries()]
    .map(([id, s]) => {
      const c = known.get(id);
      return { category: id, name: categoryName(c ?? { id, type, icon: 'more' }, locale), icon: c?.icon ?? 'more', amount: toYuan(s.fen), share: all ? Math.round((s.fen / all) * 1000) / 1000 : 0, count: s.count };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

export interface Bucket {
  key: string;
  expense: number;
  income: number;
}

/** Every day (or month) of the range in order, zero-filled, so charts have no holes. */
export function series(entries: Entry[], r: Range): Bucket[] {
  const keyOf = r.unit === 'month' ? monthKey : dayKey;
  const map = new Map(bucketKeys(r).map((k) => [k, { expense: 0, income: 0 }]));
  for (const e of inRange(entries, r)) {
    const b = map.get(keyOf(e.at));
    if (!b) continue;
    if (e.type === 'income') b.income += toFen(e.amount);
    else b.expense += toFen(e.amount);
  }
  return [...map.entries()].map(([key, b]) => ({ key, expense: toYuan(b.expense), income: toYuan(b.income) }));
}

/** Ratio change from `before` to `now` (0.25 = +25%), null when there is nothing to compare. */
export const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 1000 : null);

export interface BudgetLine {
  /** 'total' or an expense category id. */
  scope: string;
  name: string;
  budget: number;
  spent: number;
  remaining: number;
  /** spent / budget, 0..∞ (3 decimals). */
  percent: number;
  /** Share of the month gone, 0..1. */
  elapsed: number;
  /** Spending at the current pace by month end. */
  projected: number;
  /**
   * 'over': already past the budget; 'ahead': spending faster than the month passes (on course
   * to exceed it); 'ok' otherwise.
   */
  status: 'ok' | 'ahead' | 'over';
  /** What is left per remaining day (today included), yuan; 0 when over. */
  perDayLeft: number;
}

/**
 * Budget status of one local month. `now` decides how much of the month has passed (a past
 * month counts as complete, a future one as not started).
 */
export function budgetStatus(entries: Entry[], month: string, settings: Settings, now = Date.now(), locale: Locale = 'zh-Hans'): { month: string; daysLeft: number; lines: BudgetLine[] } {
  const { start, end } = monthBounds(month);
  const days = daysInMonth(month);
  const monthEntries = inRange(entries, { start, end }).filter((e) => e.type === 'expense');
  const elapsed = now >= end ? 1 : now < start ? 0 : Math.min(1, (now - start) / (end - start));
  // Days left including today (a past month has none).
  const daysLeft = now >= end ? 0 : now < start ? days : days - new Date(now).getDate() + 1;
  const line = (scope: string, name: string, budget: number, list: Entry[]): BudgetLine => {
    const spentFen = list.reduce((s, e) => s + toFen(e.amount), 0);
    const budgetFen = toFen(budget);
    const spent = toYuan(spentFen);
    const projected = elapsed > 0 ? toYuan(Math.round(spentFen / elapsed)) : spent;
    const status = spentFen > budgetFen ? 'over' : elapsed > 0 && elapsed < 1 && spentFen / budgetFen > elapsed + 0.05 && projected > budget ? 'ahead' : 'ok';
    const remainingFen = budgetFen - spentFen;
    return {
      scope,
      name,
      budget: toYuan(budgetFen),
      spent,
      remaining: toYuan(remainingFen),
      percent: budgetFen ? Math.round((spentFen / budgetFen) * 1000) / 1000 : 0,
      elapsed: Math.round(elapsed * 1000) / 1000,
      projected,
      status,
      perDayLeft: daysLeft > 0 && remainingFen > 0 ? toYuan(Math.floor(remainingFen / daysLeft)) : 0,
    };
  };
  const lines: BudgetLine[] = [];
  const b = settings.budgets;
  if (b.total && b.total > 0) lines.push(line('total', locale === 'en' ? 'Total' : '总预算', b.total, monthEntries));
  const known = new Map(settings.categories.map((c) => [c.id, c]));
  for (const [id, amount] of Object.entries(b.categories)) {
    if (!(amount > 0)) continue;
    const c = known.get(id);
    if (!c) continue;
    lines.push(line(id, categoryName(c, locale), amount, monthEntries.filter((e) => e.category === id)));
  }
  return { month, daysLeft, lines };
}

/** The largest entries (default: spending), biggest first. */
export function topEntries(entries: Entry[], n = 5, type: EntryType = 'expense'): Entry[] {
  return entries
    .filter((e) => e.type === type)
    .sort((a, b) => b.amount - a.amount || b.at - a.at)
    .slice(0, n);
}

/** Entries grouped by local day, newest day first, each day newest first. */
export function groupByDay(entries: Entry[]): { day: string; entries: Entry[]; totals: Totals }[] {
  const map = new Map<string, Entry[]>();
  for (const e of [...entries].sort((a, b) => b.at - a.at)) {
    const k = dayKey(e.at);
    const list = map.get(k);
    if (list) list.push(e);
    else map.set(k, [e]);
  }
  return [...map.entries()].map(([day, list]) => ({ day, entries: list, totals: totals(list) }));
}

/** Keep the n largest shares and fold the rest into one "其他" row (donut readability). */
export function foldShares(shares: CategoryShare[], n: number, otherName: string): CategoryShare[] {
  if (shares.length <= n) return shares;
  const head = shares.slice(0, n - 1);
  const rest = shares.slice(n - 1);
  const fen = rest.reduce((s, c) => s + toFen(c.amount), 0);
  return [
    ...head,
    { category: '*rest', name: otherName, icon: 'more', amount: toYuan(fen), share: Math.round(rest.reduce((s, c) => s + c.share, 0) * 1000) / 1000, count: rest.reduce((s, c) => s + c.count, 0) },
  ];
}
