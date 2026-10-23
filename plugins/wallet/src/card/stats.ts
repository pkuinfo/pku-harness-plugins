/**
 * Monthly spending statistics (月度统计), ported from pkucli crates/campuscard/src
 * commands.rs `cmd_stats` + api.rs `get_turnover_count` / `get_category_stats` / `get_daily_stats`
 * + display.rs `print_monthly_stats`. Pure helpers; amounts arrive as fen (floats) and leave as yuan.
 */

/** api.rs TurnoverCount: month totals, fen. */
export type TurnoverCount = { income: number; expenses: number };
/** api.rs TurnoverCategory: one 支出分类 row, fen. */
export type TurnoverCategory = { turnoverType?: string | null; amount: number };
/** api.rs get_daily_stats: { "YYYY-MM-DD": fen }. */
export type DailyStats = Record<string, number>;

/** `type` value the stats endpoints use for spending (commands.rs passes 2 = 支出). */
export const TYPE_EXPENSE = 2;

const pad = (n: number) => String(n).padStart(2, '0');
const toYuan = (fen: unknown) => (typeof fen === 'number' && Number.isFinite(fen) ? Math.round(fen) / 100 : 0);

/** "YYYY-MM" → first/last day of that month (commands.rs last_day_of_month). Throws a friendly error on bad input. */
export function monthRange(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const year = m ? Number(m[1]) : NaN;
  const mon = m ? Number(m[2]) : NaN;
  if (!m || mon < 1 || mon > 12) throw new Error('月份格式错误，请使用 YYYY-MM');
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** Current month as "YYYY-MM" in local time (cmd_stats default). */
export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** Endpoint paths, relative to bdcard.pku.edu.cn (api.rs). */
export function statsUrls(month: string, type = TYPE_EXPENSE) {
  const { from, to } = monthRange(month);
  return {
    count: `/berserker-search/statistics/turnover/count?timeFrom=${from}&timeTo=${to}&synAccessSource=h5`,
    categories: `/berserker-search/statistics/turnover?type=${type}&timeFrom=${from}&timeTo=${to}&synAccessSource=h5`,
    daily: `/berserker-search/statistics/turnover/sum/user?dateStr=${month}&dateType=month&statisticsDateStr=day&type=${type}&synAccessSource=h5`,
  };
}

/**
 * Combine the three responses into one model-friendly summary (display.rs print_monthly_stats):
 * categories sorted by amount desc (unnamed → 其他) with share of spending; daily keeps only days
 * with spending, sorted by date.
 */
export function summarizeMonth(month: string, count: TurnoverCount, categories: TurnoverCategory[] | null | undefined, daily: DailyStats | null | undefined) {
  const income = toYuan(count?.income);
  const expenses = toYuan(count?.expenses);
  const cats = (categories ?? [])
    .map((c) => ({ category: c.turnoverType?.trim() || '其他', amount: toYuan(c.amount) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((c) => ({ ...c, share: expenses > 0 ? Math.round((c.amount / expenses) * 1000) / 1000 : null }));
  const days = Object.entries(daily ?? {})
    .map(([date, fen]) => ({ date, amount: toYuan(fen) }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const top = days.reduce<(typeof days)[number] | null>((best, d) => (best == null || d.amount > best.amount ? d : best), null);
  const spent = days.reduce((s, d) => s + d.amount, 0);
  return {
    month,
    income,
    expenses,
    net: Math.round((income - expenses) * 100) / 100,
    categories: cats,
    daily: days,
    activeDays: days.length,
    averagePerActiveDay: days.length ? Math.round((spent / days.length) * 100) / 100 : null,
    biggestDay: top,
  };
}
