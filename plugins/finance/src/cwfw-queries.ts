import { amount, initVars, type QueryResp, type QueryRow, type UserContext } from './parse';
import {
  beforeLoadProc,
  buildArgs,
  cvstr,
  enterSubsystem,
  findCheck,
  findProc,
  mapEntry,
  parseLocal,
  parseMenu,
  parseOptions,
  seedForm,
  Wf,
  type FormValues,
  type MenuEntry,
  type Services,
} from './cwfw-wf';

/**
 * Read-only finance-portal queries (pkucli crates/cwfw/src/queries.rs). Window / function numbers
 * are static portal configuration (captured 2026-10 on a student account):
 *
 * | menu                                   | winno       | form  | grid               |
 * |----------------------------------------|-------------|-------|--------------------|
 * | 收入查询-个人工资查询 (6941 → 5609)     | 5609        | 5574  | 6160 (cross table) |
 * | 借款查询                                | 6320        | 6241  | 6243               |
 * | 薪酬劳务查询                            | 7320        | 7181  | 7183               |
 * | 外汇信息查询 (foreign remittances)       | 7600 → 7640 | 10819 | 13522              |
 * | 汇率查询                                | 7700 → 7722 | 13562 | 13583              |
 * | 银行入卡-我的入卡                        | 7987        | 15030 | 15028              |
 * | 智能报销 home (YBX subsystem)           | 6           | —     | beforeLoad proc → `local(…)` |
 *
 * Procedure / select-source hashes are parsed from the window definition every time.
 */

const PROJECT = 'WF_CWBS';
const pad2 = (n: number) => String(n).padStart(2, '0');
const cell = (r: QueryRow, i: number) => (r.cell[i] ?? '').trim();
const dateOnly = (s: string) => s.split(/\s+/)[0] ?? '';
const isTotal = (r: QueryRow) => r.cell.slice(0, 2).some((c) => c.includes('合计') || c.includes('总计'));

/** WF_CWBS session: userContext from loadRolesMenu (+ loadInitFunction, best effort). */
export async function openCwbs(services: Services) {
  const probe = new Wf(services, '');
  const ctx = await probe.userContext();
  if (!ctx) throw new Error('财务门户会话未建立（没有拿到用户信息），请稍后重试');
  const extra = await probe.raw('loadInitFunction.action', '').then(initVars, () => ({}));
  const uid = String(ctx['0-USERINFO.USERID'] ?? '') || services.campus.status().username || '';
  if (!uid) throw new Error('财务门户没有返回学号/工号');
  const base: UserContext = { ...ctx, ...extra, '0-USERINFO.USERID': uid, '0-UNINO': uid };
  return { wf: new Wf(services, uid), ctx: base };
}

/** A select's options (`bindMap`): dynamic sources via getBindingDataBackend, static ones parsed. */
async function fieldOptions(wf: Wf, def: string, field: string, form: FormValues, ctx: UserContext) {
  const e = mapEntry(def, 'bindMap', field);
  if (!e) return [];
  if (e.head.startsWith('@$')) return parseOptions(await wf.binding(e.head.slice(2), cvstr(e.params, form, ctx)));
  return parseOptions(e.head);
}

/** A triggered field (`funcMap`): computed by the server from other fields; null when none. */
async function resolveField(wf: Wf, def: string, field: string, form: FormValues, ctx: UserContext) {
  const e = mapEntry(def, 'funcMap', field);
  if (!e || !e.head.startsWith('`$')) return null;
  const v = await wf.check(e.head, buildArgs(e.params, form, ctx), ctx);
  return v === 'error' ? null : v;
}

/** One "form + 查询 button" run; returns the userContext the server now holds. */
async function runForm(
  wf: Wf,
  base: UserContext,
  q: { winno: string; func: string; first: string; menuNode: number; withCheck?: boolean; def?: string },
  form: FormValues,
) {
  const def = q.def ?? (await wf.loadWindow(q.winno));
  const proc = findProc(def, q.first);
  if (!proc) throw new Error('没能解析财务门户的查询页面（系统可能已改版）');
  const ctx = seedForm(base, PROJECT, q.func, form, q.menuNode);
  const chk = q.withCheck ? findCheck(def, q.first) : null;
  await wf.button(proc.hash, buildArgs(proc.params, form, ctx), ctx, chk ? { hash: chk.hash, data: buildArgs(chk.params, form, ctx) } : undefined);
  return ctx;
}

// ───────────────────────── menu ─────────────────────────

export async function queryMenu(services: Services): Promise<MenuEntry[]> {
  const { wf } = await openCwbs(services);
  const entries = parseMenu(await wf.raw('loadMenu.action', ''));
  if (!entries.length) throw new Error('没有拿到财务门户菜单（会话可能已过期）');
  return entries;
}

// ───────────────────────── 个人工资 / 奖助学金 ─────────────────────────

export type SalaryItem = { name: string; months: { month: number; amount: number }[]; total: number | null; itemCode: string };
export type SalarySection = { code: string; title: string; items: SalaryItem[] };

/** Columns when crossfieldrebuild fails: qq.ym, mon<from>..mon<to>, sum, qq.ord, qq.gztype, qq.remark, qq.itemcode, qq.unino. */
export function defaultSalaryFields(from: number, to: number): [string, string][] {
  const f: [string, string][] = [['qq.ym', '']];
  for (let m = from; m <= to; m++) f.push([`mon${m}`, `${m}月`]);
  for (const k of ['sum', 'qq.ord', 'qq.gztype', 'qq.remark', 'qq.itemcode', 'qq.unino']) f.push([k, '']);
  return f;
}

/** queries.rs `salary_items`: cross table 6160 rows → items with per-month amounts (the 工号 column is dropped). */
export function salaryItems(resp: QueryResp, fields: [string, string][]): SalaryItem[] {
  const idx = (n: string) => fields.findIndex(([f]) => f === n);
  const nameI = Math.max(idx('qq.ym'), 0);
  const sumI = idx('sum');
  const codeI = idx('qq.itemcode');
  return resp.rows
    .map((r) => ({
      name: cell(r, nameI),
      months: fields
        .map(([f], i) => {
          const m = /^mon(\d+)$/.exec(f);
          const v = m ? amount(cell(r, i)) : null;
          return m && v != null ? { month: Number(m[1]), amount: v } : null;
        })
        .filter((x): x is { month: number; amount: number } => !!x),
      total: sumI >= 0 ? amount(cell(r, sumI)) : null,
      itemCode: codeI >= 0 ? cell(r, codeI) : '',
    }))
    .filter((i) => i.name);
}

/** 个人工资查询 (students: scholarships, stipends, living subsidies paid monthly). `only` = one 查询功能 code. */
export async function querySalary(services: Services, year: number, from: number, to: number, only?: string): Promise<SalarySection[]> {
  const { wf, ctx: base } = await openCwbs(services);
  const def = await wf.loadWindow('5609');
  let options = await fieldOptions(wf, def, 'd.funcno', [], base);
  if (only) options = options.filter(([c]) => c === only);
  if (!options.length) throw new Error(only ? `没有代码为 ${only} 的工资查询功能` : '这个账号在财务门户里没有可查询的工资/奖助学金项目');
  const out: SalarySection[] = [];
  for (const [code, title] of options) {
    const form: FormValues = [['d.funcno', code]];
    // triggers: 收入类型 → 代码/库 → 发布方式
    for (const f of ['d.incometype', 'd.code', 'd.dbcode', 'd.pubdate']) form.push([f, (await resolveField(wf, def, f, form, base)) ?? '']);
    form.push(['d.year', String(year)], ['d.month_1', pad2(from)], ['d.month_2', pad2(to)]);
    // the grid window's beforeLoad procedure (the page runs it on open); not fatal
    const before = beforeLoadProc(def);
    if (before) await wf.button(before.hash, buildArgs(before.params, form, base), base).catch(() => undefined);
    const ctx = await runForm(wf, base, { winno: '5609', func: '5574', first: '5574-d.year', menuNode: 219, def }, form);
    const fields = await wf
      .crossFields('6160', ctx)
      .then((f) => (f.some(([k]) => k.startsWith('mon')) ? f : defaultSalaryFields(from, to)))
      .catch(() => defaultSalaryFields(from, to));
    out.push({ code, title, items: salaryItems(await wf.doQuery('6160', 'qq.ord ASC', 10000), fields) });
  }
  return out;
}

// ───────────────────────── 银行入卡 ─────────────────────────

export type CardDeposit = {
  reqNo: string;
  handler: string;
  unit: string;
  summary: string;
  amount: number | null;
  paid: number | null;
  tax: number | null;
  status: string;
  errorCode: string;
};

/** Grid 15028: req_no, req_name 经办人, depart 发放部门, remark 摘要, amt, paid_amt 入卡金额, tax, status, caozuo, errir_id. */
export const cardDepositsFrom = (resp: QueryResp): CardDeposit[] =>
  resp.rows
    .filter((r) => !isTotal(r))
    .map((r) => ({
      reqNo: cell(r, 0),
      handler: cell(r, 1),
      unit: cell(r, 2),
      summary: cell(r, 3),
      amount: amount(cell(r, 4)),
      paid: amount(cell(r, 5)),
      tax: amount(cell(r, 6)),
      status: cell(r, 7),
      errorCode: cell(r, 9),
    }));

/** 我的入卡: payouts to the user's bank card in [since, until] (YYYY-MM-DD). */
export async function queryCardDeposits(services: Services, since: string, until: string) {
  const { wf, ctx: base } = await openCwbs(services);
  // this 查询 button has no procedure: the grid SQL reads the form values from userContext
  const form: FormValues = [
    ['d.req_no', ''],
    ['d.jbrno', ''],
    ['d.status', ''],
    ['d.date1', since],
    ['d.date2', until],
    ['d.min_amt', ''],
    ['d.max_amt', ''],
  ];
  const ctx = { ...seedForm(base, PROJECT, '15030', form, 271), '0-REFFUNC15028': 15030, '0-CURRWIN': 7987 };
  await wf.post('common_updateUserContext.action', [['userContext', JSON.stringify(ctx)]]).catch(() => undefined);
  return cardDepositsFrom(await wf.doQuery('15028', '', 500, ctx));
}

// ───────────────────────── 借款 ─────────────────────────

export type Loan = { firstDate: string; summary: string; project: string; clearNo: string; firstAmount: number | null; cleared: number | null; balance: number | null };

/** Grid 6243: first_clr_date, sabstract, uni_prj_order, clr_order, first_jf_amt, nxt_amt 已核销, jf_amt 余额, unino, pid. */
export const loansFrom = (resp: QueryResp): Loan[] =>
  resp.rows
    .filter((r) => !isTotal(r))
    .map((r) => ({
      firstDate: dateOnly(cell(r, 0)),
      summary: cell(r, 1),
      project: cell(r, 2),
      clearNo: cell(r, 3),
      firstAmount: amount(cell(r, 4)),
      cleared: amount(cell(r, 5)),
      balance: amount(cell(r, 6)),
    }));

export async function queryLoans(services: Services) {
  const { wf, ctx: base } = await openCwbs(services);
  const def = await wf.loadWindow('6320');
  let options = await fieldOptions(wf, def, 'd.func', [], base);
  if (!options.length) options = [['1', '']];
  const before = beforeLoadProc(def);
  if (before) await wf.button(before.hash, buildArgs(before.params, [], base), base).catch(() => undefined);
  const out: Loan[] = [];
  for (const [code] of options) {
    await runForm(wf, base, { winno: '6320', func: '6241', first: '6241-d.func', menuNode: 239, def }, [['d.func', code]]);
    out.push(...loansFrom(await wf.doQuery('6243', 'to_number(t.pid) ASC', 500)));
  }
  return out;
}

// ───────────────────────── 汇率 ─────────────────────────

export type FxRate = { currency: string; date: string; ratePer100: number | null };

/** Grid 13583: wh_type, create_date, wh_rate (中行折算价 per 100 units). */
export const fxRatesFrom = (resp: QueryResp): FxRate[] => resp.rows.map((r) => ({ currency: cell(r, 0), date: dateOnly(cell(r, 1)), ratePer100: amount(cell(r, 2)) }));

export async function queryFxRates(services: Services, currency: string, since: string, until: string) {
  const { wf, ctx: base } = await openCwbs(services);
  await runForm(wf, base, { winno: '7700', func: '13562', first: '13562-t.start', menuNode: 253 }, [
    ['t.start', since],
    ['t.end', until],
    ['t.btype', currency],
  ]);
  return fxRatesFrom(await wf.doQuery('13583', '', 2000));
}

// ───────────────────────── 外汇到款 ─────────────────────────

export type Remittance = {
  date: string;
  remitter: string;
  settledAmount: number | null;
  amount: number | null;
  currency: string;
  origin: string;
  remark: string;
  status: string;
  bankDate: string;
};

/**
 * Grid 13522: notify_date, income_unit, exchange_amt, income_amt, currency, income_addr, remark, status,
 * tel, bank_date, exchange_user, opt_code, opt_name, log_id, userid, log_date. Phone numbers and the
 * names of staff / contacts (third-party personal data) are not returned.
 */
export const remittancesFrom = (resp: QueryResp): Remittance[] =>
  resp.rows.map((r) => ({
    date: dateOnly(cell(r, 0)),
    remitter: cell(r, 1),
    settledAmount: amount(cell(r, 2)),
    amount: amount(cell(r, 3)),
    currency: cell(r, 4),
    origin: cell(r, 5),
    remark: cell(r, 6),
    status: cell(r, 7),
    bankDate: dateOnly(cell(r, 9)),
  }));

export type RemittanceQuery = {
  keyword: string;
  allWords?: boolean;
  from: { year: number; month: number };
  to: { year: number; month: number };
  /** AUD CAD CHF CNY EUR GBD HKD RMB SEK SGD USD 其他 全部 */
  currency: string;
  min: number;
  max: number;
};

/** The portal refuses an amount range wider than 100,000. */
export const REMITTANCE_MAX_SPAN = 100_000;

/** 外汇信息查询: foreign remittances received by PKU, searched by remitter name (uppercase English). */
export async function queryRemittances(services: Services, q: RemittanceQuery) {
  const kw = q.keyword.trim().toUpperCase();
  if (!kw) throw new Error('请提供汇款单位关键词（英文）');
  if (q.max < q.min) throw new Error('最大金额不能小于最小金额');
  if (q.max - q.min > REMITTANCE_MAX_SPAN) throw new Error('财务门户要求金额范围的差额不超过 10 万');
  const { wf, ctx: base } = await openCwbs(services);
  const ran = await runForm(wf, base, { winno: '7600', func: '10819', first: '10819-t.year2', menuNode: 252, withCheck: true }, [
    ['t.year', String(q.from.year)],
    ['t.year2', String(q.to.year)],
    ['t.month_1', pad2(q.from.month)],
    ['t.month_2', pad2(q.to.month)],
    ['t.abstractAny', q.allWords ? '' : kw],
    ['t.abstractAll', q.allWords ? kw : ''],
    ['t.outAmt1', String(q.min)],
    ['t.outAmt2', String(q.max)],
    ['t.currency', q.currency],
    ['t.funcno', ''],
  ]).then(
    () => true,
    (e: unknown) => {
      // the check function answers "没有合适的结果" when nothing matches
      if (e instanceof Error && e.message.includes('没有合适的结果')) return false;
      throw e;
    },
  );
  return ran ? remittancesFrom(await wf.doQuery('13522', '', 1000)) : [];
}

// ───────────────────────── 薪酬劳务 (payer / project view) ─────────────────────────

export const PAYROLL_KINDS = { 0: '学生发放', 1: '薪酬劳务', 2: '奖助学金', 3: '合同制工资', 4: '博士后工资', 5: '研究技术系列人员工资' } as const;

export type PayrollRecord = {
  date: string;
  voucher: string;
  summary: string;
  projectCode: string;
  projectName: string;
  amount: number | null;
  payee: string;
  personType: string;
  gross: number | null;
  method: string;
};

/**
 * Grid 7183: ym, pz_unino, sabstract, prj_code, prj_name, j_amount, sno, cercode_name, personid, card,
 * branchname, sname, m_name, sk_amt, ff_type, …. Staff/student numbers, ID numbers, bank cards and
 * bank names are never returned.
 */
export const payrollFrom = (resp: QueryResp): PayrollRecord[] =>
  resp.rows
    .filter((r) => !isTotal(r))
    .map((r) => ({
      date: dateOnly(cell(r, 0)),
      voucher: cell(r, 1),
      summary: cell(r, 2),
      projectCode: cell(r, 3),
      projectName: cell(r, 4),
      amount: amount(cell(r, 5)),
      payee: cell(r, 11),
      personType: cell(r, 12),
      gross: amount(cell(r, 13)),
      method: cell(r, 14),
    }));

export async function queryPayroll(services: Services, kind: keyof typeof PAYROLL_KINDS, since: string, until: string, project = '') {
  const { wf, ctx: base } = await openCwbs(services);
  await runForm(wf, base, { winno: '7320', func: '7181', first: '7181-t.stype', menuNode: 246 }, [
    ['t.stype', String(kind)],
    ['t.startdate', since],
    ['t.sno', ''],
    ['t.sname', ''],
    ['t.prjcode', project],
    ['t.enddate', until],
  ]);
  return payrollFrom(await wf.doQuery('7183', 'ccd.ym ASC, ccd.pz_unino ASC', 2000));
}

// ───────────────────────── 智能报销 overview (YBX) ─────────────────────────

/** Counter prefixes on the 智能报销 home page. */
export const REIMBURSE_KEYS = [
  ['BX_YBXALL', 'all', '全部报销单'],
  ['BX_YBXCG', 'draft', '草稿'],
  ['BX_YBXSPZ', 'approving', '审批中'],
  ['BX_DTD', 'toDeliver', '待投递'],
  ['BX_YBXWC', 'toBook', '待入账（财务处理中）'],
  ['BX_YBXTH', 'returned', '被退回/待补充'],
  ['BX_YBXZFSB', 'paymentFailed', '支付失败'],
  ['V2_dsp', 'awaitingMyApproval', '待我审批'],
  ['tks', 'unusedInvoices', '票夹中待报销票据'],
  ['BX_HIS', 'history', '历史报销单（含网报）'],
] as const;

export type ReimburseStat = { key: (typeof REIMBURSE_KEYS)[number][1]; label: string; count: number | null; amount: number | null };

/** queries.rs `reimburse_stats`: names vary in case (`_count`/`_COUNT`) and one is misspelt (`_AMOUT`). */
export function reimburseStats(local: Record<string, string>): ReimburseStat[] {
  const find = (prefix: string, suffixes: string[]) => {
    for (const [k, v] of Object.entries(local)) {
      if (!k.startsWith(`${prefix}_`)) continue;
      if (suffixes.includes(k.slice(prefix.length + 1).toLowerCase())) return amount(v);
    }
    return null;
  };
  return REIMBURSE_KEYS.map(([prefix, key, label]) => ({ key, label, count: find(prefix, ['count']), amount: find(prefix, ['amt', 'amount', 'amout']) })).filter(
    (s) => s.count != null || s.amount != null,
  );
}

/** 智能报销 (YBX) home page: how many claims are in each state and their totals. */
export async function queryReimbursements(services: Services) {
  const probe = new Wf(services, '', 'YBX', 'WF_YBX');
  let ctx = await probe.userContext();
  if (!ctx) {
    await enterSubsystem(services, 'WF_YBX');
    ctx = await probe.userContext();
  }
  if (!ctx) throw new Error('进入智能报销系统失败，请稍后重试');
  const uid = String(ctx['0-USERINFO.USERID'] ?? '') || services.campus.status().username || '';
  const wf = new Wf(services, uid, 'YBX', 'WF_YBX');
  const def = await wf.loadWindow('6');
  const proc = beforeLoadProc(def);
  if (!proc) throw new Error('没能解析智能报销首页（系统可能已改版）');
  const args = buildArgs(proc.params, [], ctx).map((a) => (a.name.toLowerCase() === 'userinfo.userid' && !a.value ? { ...a, value: uid } : a));
  return reimburseStats(parseLocal(await wf.button(proc.hash, args, ctx)));
}
