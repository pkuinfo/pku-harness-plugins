/**
 * Pure parsers for the Wingsoft finance portal (pkucli crates/cwfw/src/context.rs, api.rs,
 * display.rs). No I/O here so they can be unit-tested.
 */

export type UserContext = Record<string, unknown>;

/**
 * context.rs `fetch_user_context`: loadRolesMenu.action embeds
 * `<input id="userContext" value="[{_@KEY_@:_@VALUE_@,...}]" />`, where `_@` stands for `"`
 * (and a trailing comma may precede `}` / `]`). Returns null when absent (no session).
 */
export function parseUserContext(html: string): UserContext | null {
  const raw = /id="userContext"[^>]*value="(\[\{[^"]*\}\])"/.exec(html)?.[1];
  if (!raw) return null;
  const json = raw.replace(/_@/g, '"').replace(/,(\s*[}\]])/g, '$1');
  try {
    const list = JSON.parse(json) as UserContext[];
    return list[0] && typeof list[0] === 'object' ? { ...list[0] } : null;
  } catch {
    return null;
  }
}

/** context.rs `load_init_function`: `[{varname, data}]` merged as `0-<VARNAME>`. */
export function initVars(body: string): UserContext {
  const out: UserContext = {};
  try {
    const list = JSON.parse(body) as { varname?: string; data?: unknown }[];
    if (Array.isArray(list)) for (const v of list) if (v?.varname) out[`0-${v.varname.toUpperCase()}`] = v.data ?? null;
  } catch {
    // not fatal (commands.rs ignores this step's failure)
  }
  return out;
}

/**
 * api.rs `fetch_reward_query_proc`: the 查询 button of window 5802 is bound to a per-session
 * stored-procedure reference `` `$<md5> `` inside `procs:["`$<hash>:#5743-d.year#;…"]`.
 */
export function parseProcHash(definition: string): string | null {
  return /procs:\["(`\$[a-f0-9]{32}):/.exec(definition)?.[1] ?? null;
}

/** api.rs `normalize_js_object`: quote bare object keys (`{total:1,rows:[{id:"…"}]}`). */
export const normalizeJsObject = (raw: string) => raw.replace(/([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');

/** api.rs `decode_numeric_entities`: `&#20167;` → 仇. */
export const decodeEntities = (s: string) =>
  s.replace(/&#(\d+);/g, (m, n: string) => {
    const c = Number(n);
    return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m;
  });

export type QueryRow = { id: string; cell: string[] };
export type QueryResp = { total: number; page: number; records: number; rows: QueryRow[] };

/** api.rs `DoQueryResp::parse`: the commonQuery_doQuery.action grid. */
export function parseDoQuery(raw: string): QueryResp {
  const text = raw.trim();
  if (text.includes('SYS_ERROR')) throw new Error('财务系统返回错误，请稍后再试');
  let j: Partial<QueryResp>;
  try {
    j = JSON.parse(normalizeJsObject(text)) as Partial<QueryResp>;
  } catch {
    throw new Error('财务系统返回了无法识别的数据（会话可能已过期）');
  }
  return {
    total: Number(j.total ?? 0),
    page: Number(j.page ?? 0),
    records: Number(j.records ?? 0),
    rows: (j.rows ?? []).map((r) => ({ id: String(r?.id ?? ''), cell: (r?.cell ?? []).map((c) => decodeEntities(String(c ?? ''))) })),
  };
}

/** "1,234.50" / "" → number | null. */
export function amount(s: string | undefined): number | null {
  const t = (s ?? '').replace(/[,，\s¥]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type RewardRecord = {
  item: string;
  projectCode: string;
  /** 发放类型: how it is paid out, usually the bank (e.g. 农业银行). */
  payoutMethod: string;
  gross: number | null;
  tax: number | null;
  net: number | null;
  /** paid = 已发放 (paidAt is its date); pending = entered but not paid out yet (未发布). */
  status: 'paid' | 'pending';
  paidAt: string | null;
  enteredAt: string;
  /** 经办人: who filed the payment (often a teacher or office staff). */
  submittedBy: string;
  /** 发放部门: the unit paying it. */
  payingUnit: string;
};

export type RewardTotals = { gross: number | null; tax: number | null; net: number | null };

/**
 * display.rs `render_reward_query` column map of grid 5746: 0 项目/名称, 1 项目代码, 2 发放类型,
 * 3 发放金额, 4 扣税金额, 5 实发金额, 6 录入时间, 7 发放时间, 8 经办人, 10 发放部门. The last row
 * is usually 总计 (`split_total`).
 */
export function rewardRecords(rows: QueryRow[]): { records: RewardRecord[]; totals: RewardTotals | null } {
  const c = (r: QueryRow, i: number) => (r.cell[i] ?? '').trim();
  const last = rows[rows.length - 1];
  const hasTotal = !!last && c(last, 0).includes('总计');
  const data = hasTotal ? rows.slice(0, -1) : rows;
  const records = data.map((r): RewardRecord => {
    const paid = c(r, 7);
    const isDate = /^\d{4}[-/.年]\d{1,2}/.test(paid);
    return {
      item: c(r, 0),
      projectCode: c(r, 1),
      payoutMethod: c(r, 2),
      gross: amount(c(r, 3)),
      tax: amount(c(r, 4)),
      net: amount(c(r, 5)),
      status: isDate ? 'paid' : 'pending',
      paidAt: isDate ? paid : null,
      enteredAt: c(r, 6),
      submittedBy: c(r, 8),
      payingUnit: c(r, 10),
    };
  });
  const totals = hasTotal ? { gross: amount(c(last, 3)), tax: amount(c(last, 4)), net: amount(c(last, 5)) } : rewardTotals(records);
  return { records, totals };
}

export type MonthTotal = { month: string; count: number; gross: number; tax: number; net: number };

/** 酬金按月汇总: group by the 发放时间 month (falls back to 录入时间), oldest first. */
export function rewardsByMonth(records: RewardRecord[]): MonthTotal[] {
  const map = new Map<string, MonthTotal>();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const r of records) {
    const month = /^(\d{4})[-/.年](\d{1,2})/.exec(r.paidAt ?? r.enteredAt);
    const key = month ? `${month[1]}-${month[2].padStart(2, '0')}` : '未知';
    const m = map.get(key) ?? { month: key, count: 0, gross: 0, tax: 0, net: 0 };
    m.count += 1;
    m.gross = r2(m.gross + (r.gross ?? 0));
    m.tax = r2(m.tax + (r.tax ?? 0));
    m.net = r2(m.net + (r.net ?? 0));
    map.set(key, m);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** The date a record counts on: when it was paid, or when it was entered if not paid yet. */
export const rewardDate = (r: RewardRecord) => (r.paidAt ?? r.enteredAt).replace(/[/.年月]/g, '-').replace(/日$/, '');

/** Records whose date falls in [since, until] (YYYY-MM-DD, inclusive; either may be omitted). */
export function rewardsBetween(records: RewardRecord[], since?: string, until?: string): RewardRecord[] {
  return records.filter((r) => {
    const d = rewardDate(r).slice(0, 10);
    return (!since || d >= since) && (!until || d <= until);
  });
}

/** Gross / tax / net sums of some records (null when there are none). */
export function rewardTotals(records: RewardRecord[]): RewardTotals | null {
  if (!records.length) return null;
  const sum = (k: 'gross' | 'tax' | 'net') => {
    const vals = records.map((r) => r[k]).filter((v): v is number => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  };
  return { gross: sum('gross'), tax: sum('tax'), net: sum('net') };
}

