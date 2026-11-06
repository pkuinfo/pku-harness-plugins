import { defineTool, formatClock, type KV, type ToolDef } from '@pku-harness/sdk';
import { z } from 'zod';

import { budgetStatus, byCategory, change, inRange, series, topEntries, totals } from './aggregate';
import { accountName, CATEGORY_ICONS, categoryName, OTHER, resolveAccount, resolveCategory, type Category, type Entry, type EntryType, type Settings } from './model';
import { insert, loadRange, loadSettings, patch, remove, saveSettings } from './store';
import { DAY_RE, dayKey, monthBounds, monthKey, MONTH_RE, parseDay, parseWhen, previousRange, resolvePeriod, round2, type Range } from './time';

/** Largest single amount we accept (yuan): catches a misplaced decimal point or a phone number. */
export const MAX_AMOUNT = 10_000_000;

const amount = z
  .number()
  .positive()
  .max(MAX_AMOUNT)
  .refine((v) => Math.abs(round2(v) - v) < 1e-9, { message: '金额最多两位小数' })
  .describe('yuan, > 0, at most 2 decimals; the sign comes from type');
const type = z.enum(['expense', 'income']).describe('expense = 支出 (default), income = 收入');
const when = z.string().max(40).describe('"YYYY-MM-DD" or "YYYY-MM-DD HH:mm", local time; default now. 昨天/上周五 etc. → compute the date');
const day = z
  .string()
  .regex(DAY_RE, 'YYYY-MM-DD')
  .refine((v) => {
    try {
      return parseDay(v) > 0;
    } catch {
      return false;
    }
  }, 'no such day');
const month = z.string().regex(MONTH_RE, 'YYYY-MM');

const entryInput = z.object({
  type: type.optional(),
  amount,
  category: z.string().min(1).max(20).optional().describe('category name (e.g. 餐饮, 交通, 生活费) or id; default 其他'),
  account: z.string().max(20).optional().describe('校园卡 / 微信 / 支付宝 / 银行卡 / 现金; omit when unknown'),
  note: z.string().max(200).optional().describe('short description, e.g. 午饭 / 打车回宿舍'),
  when: when.optional(),
});

export const inputs = {
  add: entryInput,
  addMany: z.object({
    entries: z
      .array(entryInput.extend({ externalId: z.string().min(1).max(120).optional().describe('stable id from the source (dedupes re-imports)') }))
      .min(1)
      .max(500),
    source: z.enum(['import', 'agent']).optional().describe('import (default) for data copied from another system'),
  }),
  list: z.object({
    period: z.enum(['today', 'week', 'month', 'last-month', 'year', 'last-year']).optional(),
    month: month.optional(),
    from: day.optional(),
    to: day.optional(),
    type: type.optional(),
    category: z.string().max(20).optional(),
    account: z.string().max(20).optional(),
    keyword: z.string().max(40).optional().describe('matches note and category name'),
    limit: z.number().int().min(1).max(200).optional().describe('default 30'),
  }),
  summary: z.object({
    period: z.enum(['today', 'week', 'month', 'last-month', 'year', 'last-year', 'custom']).optional().describe('default month (this month)'),
    month: month.optional().describe('another month with period month'),
    year: z.number().int().min(2000).max(2100).optional().describe('another year with period year'),
    from: day.optional().describe('custom range start'),
    to: day.optional().describe('custom range end (inclusive)'),
    top: z.number().int().min(0).max(20).optional().describe('largest expenses to include, default 5'),
  }),
  update: z.object({
    id: z.string().min(1),
    type: type.optional(),
    amount: amount.optional(),
    category: z.string().min(1).max(20).optional(),
    account: z.string().max(20).nullable().optional().describe('null clears it'),
    note: z.string().max(200).nullable().optional().describe('null clears it'),
    when: when.optional(),
  }),
  delete: z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }),
  budgetSet: z.object({
    total: z.number().min(0).max(MAX_AMOUNT).nullable().optional().describe('monthly spending budget, yuan; 0 or null removes it'),
    category: z.string().min(1).max(20).optional().describe('expense category for a per-category budget'),
    amount: z.number().min(0).max(MAX_AMOUNT).nullable().optional().describe('that category’s monthly budget; 0 or null removes it'),
  }),
  budgetStatus: z.object({ month: month.optional().describe('default this month') }),
  categories: z.object({ type: type.optional(), includeHidden: z.boolean().optional() }),
  categoryEdit: z.object({
    action: z.enum(['add', 'rename', 'hide', 'show']),
    category: z.string().min(1).max(20).optional().describe('existing category (rename / hide / show)'),
    name: z.string().trim().min(1).max(8).optional().describe('new name (add / rename), ≤ 8 characters'),
    type: type.optional().describe('for add; default expense'),
    icon: z.enum(CATEGORY_ICONS as [string, ...string[]]).optional().describe('for add'),
  }),
};

const stamp = (at: number) => `${dayKey(at)} ${formatClock(at)}`;

/** What a tool result shows of an entry (names, not ids, except the entry id). */
export function view(e: Entry, categories: Category[]) {
  const c = categories.find((x) => x.id === e.category);
  return {
    id: e.id,
    type: e.type,
    amount: e.amount,
    category: categoryName(c ?? categories.find((x) => x.id === OTHER[e.type])),
    account: accountName(e.account) ?? '未指定',
    note: e.note ?? null,
    time: stamp(e.at),
    ...(e.source && e.source !== 'manual' ? { source: e.source } : {}),
  };
}

function categoryOf(settings: Settings, input: string | undefined, t: EntryType, strict: boolean): string {
  if (!input) return OTHER[t];
  const c = resolveCategory(settings.categories, input, t);
  if (c) return c.id;
  if (!strict) return OTHER[t];
  const names = settings.categories.filter((x) => x.type === t && !x.hidden).map((x) => categoryName(x));
  throw new Error(`没有「${input}」这个${t === 'income' ? '收入' : '支出'}分类。可用：${names.join('、')}。需要新分类就先用 categoryEdit 添加。`);
}

function accountOf(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const a = resolveAccount(input);
  if (!a) throw new Error(`没有「${input}」这个账户。可用：校园卡、微信、支付宝、银行卡、现金（不知道就不填）。`);
  return a;
}

/** Entry from validated tool input (shared by add, addMany and the quick-add screen). */
export function toEntry(input: z.infer<typeof entryInput> & { externalId?: string }, settings: Settings, source: Entry['source'], strict: boolean, now = Date.now()): Omit<Entry, 'id'> {
  const t = input.type ?? 'expense';
  const note = input.note?.trim();
  return {
    type: t,
    amount: round2(input.amount),
    category: categoryOf(settings, input.category, t, strict),
    ...(input.account ? { account: strict ? accountOf(input.account) : (resolveAccount(input.account) ?? undefined) } : {}),
    ...(note ? { note } : {}),
    at: input.when ? parseWhen(input.when, now) : now,
    source,
    ...(input.externalId ? { externalId: input.externalId } : {}),
  };
}

/** Budget lines worth mentioning after a write: over, or running ahead of the month. */
async function budgetAlerts(kv: KV, settings: Settings, at: number, category?: string) {
  const m = monthKey(at);
  const { start, end } = monthBounds(m);
  const s = budgetStatus(await loadRange(kv, start, end), m, settings);
  return s.lines
    .filter((l) => (l.scope === 'total' || l.scope === category) && l.status !== 'ok')
    .map((l) => ({ name: l.name, budget: l.budget, spent: l.spent, remaining: l.remaining, status: l.status }));
}

function rangeOf(input: { period?: Parameters<typeof resolvePeriod>[0]['period']; month?: string; year?: number; from?: string; to?: string }, now: number): Range {
  if (!input.period && !input.month && !input.year && !input.from && !input.to) return resolvePeriod({ period: 'month' }, now);
  return resolvePeriod(input, now);
}

export const tools: Record<string, ToolDef> = {
  add: defineTool({
    title: '记一笔',
    description:
      'Record one expense or income. Turn what the user said into fields with as few questions as possible: "午饭花了18" → { amount: 18, category: "餐饮", note: "午饭" }; "收到奖学金5000" → { type: "income", amount: 5000, category: "奖助学金" }; "昨天打车 32 微信" → { amount: 32, category: "交通", account: "微信", note: "打车", when: <yesterday> }. Default: today, expense, no account. Returns the entry, this month’s totals and any budget alert.',
    input: inputs.add,
    effect: 'write',
    execute: async (input, ctx) => {
      const settings = await loadSettings(ctx.kv);
      const entry = toEntry(input, settings, ctx.actor === 'agent' ? 'agent' : 'manual', true);
      const { added } = await insert(ctx.kv, [entry]);
      const m = monthKey(entry.at);
      const { start, end } = monthBounds(m);
      const month = totals(inRange(await loadRange(ctx.kv, start, end), { start, end }));
      return {
        recorded: view(added[0], settings.categories),
        month: { month: m, expense: month.expense, income: month.income },
        budgetAlerts: entry.type === 'expense' ? await budgetAlerts(ctx.kv, settings, entry.at, entry.category) : [],
      };
    },
  }),
  addMany: defineTool({
    title: '批量记账',
    description:
      'Record many entries at once (imports, e.g. campus-card transactions from wallet.cardTransactions, or several items the user listed). Give each imported item a stable externalId so importing again skips what is already there. Unknown categories fall back to 其他 and are reported, unknown accounts are dropped.',
    input: inputs.addMany,
    effect: 'write',
    execute: async ({ entries, source }, ctx) => {
      const settings = await loadSettings(ctx.kv);
      const fallbacks: string[] = [];
      const list = entries.map((e) => {
        const entry = toEntry(e, settings, source ?? 'import', false);
        if (e.category && entry.category === OTHER[entry.type] && !resolveCategory(settings.categories, e.category, entry.type)) fallbacks.push(e.category);
        return entry;
      });
      const { added, skipped } = await insert(ctx.kv, list);
      const t = totals(added);
      return {
        added: added.length,
        skippedDuplicates: skipped,
        addedExpense: t.expense,
        addedIncome: t.income,
        ...(fallbacks.length ? { unknownCategoriesAsOther: [...new Set(fallbacks)] } : {}),
      };
    },
  }),
  list: defineTool({
    title: '查看账目',
    description: 'List entries, newest first, filtered by period / month / from–to days, type, category, account or keyword. Default: this month, 30 items. Use to find an entry’s id before update or delete ("删掉刚才那笔").',
    input: inputs.list,
    effect: 'read',
    execute: async (input, ctx) => {
      const now = Date.now();
      const r = rangeOf(input, now);
      const settings = await loadSettings(ctx.kv);
      const cat = input.category ? resolveCategory(settings.categories, input.category, input.type) : undefined;
      if (input.category && !cat) throw new Error(`没有「${input.category}」这个分类`);
      const acc = input.account ? accountOf(input.account) : undefined;
      const kw = input.keyword?.trim().toLowerCase();
      const matched = inRange(await loadRange(ctx.kv, r.start, r.end), r)
        .filter((e) => (!input.type || e.type === input.type) && (!cat || e.category === cat.id) && (!acc || e.account === acc))
        .filter((e) => !kw || (e.note ?? '').toLowerCase().includes(kw) || categoryName(settings.categories.find((c) => c.id === e.category)).toLowerCase().includes(kw))
        .sort((a, b) => b.at - a.at);
      const limit = input.limit ?? 30;
      return { range: r.label, totals: totals(matched), items: matched.slice(0, limit).map((e) => view(e, settings.categories)), more: Math.max(0, matched.length - limit) };
    },
  }),
  summary: defineTool({
    title: '收支汇总',
    description:
      'Totals for a period: income, expense, net, spending and income by category (with share), a per-day series (per-month for a year or long range), the largest expenses, and a comparison with the previous period (for the current period also up to the same point, e.g. 1–5 of last month). Use for "这个月花了多少", "今年花了多少", "上个月钱都花哪了". Amounts in yuan.',
    input: inputs.summary,
    effect: 'read',
    execute: async (input, ctx) => {
      const now = Date.now();
      const r = rangeOf(input, now);
      const prev = previousRange(r);
      const settings = await loadSettings(ctx.kv);
      const all = await loadRange(ctx.kv, prev.start, r.end);
      const cur = inRange(all, r);
      const t = totals(cur);
      const before = totals(inRange(all, prev));
      const ongoing = now >= r.start && now < r.end;
      // Same elapsed span of the previous period, so a half month compares with a half month.
      const sameTime = ongoing ? totals(inRange(all, { start: prev.start, end: prev.start + (now - r.start) })) : null;
      const s = series(cur, r);
      return {
        period: { label: r.label, from: dayKey(r.start), to: dayKey(r.end - 1), ongoing },
        currency: 'CNY',
        ...t,
        expenseByCategory: byCategory(cur, 'expense', settings.categories).map(({ icon: _i, ...c }) => c),
        incomeByCategory: byCategory(cur, 'income', settings.categories).map(({ icon: _i, ...c }) => c),
        series: { unit: r.unit, points: s.filter((p) => p.expense || p.income) },
        top: topEntries(cur, input.top ?? 5).map((e) => view(e, settings.categories)),
        previous: {
          label: prev.label,
          expense: before.expense,
          income: before.income,
          expenseChange: change(t.expense, before.expense),
          ...(sameTime ? { sameTimeExpense: sameTime.expense, expenseChangeSameTime: change(t.expense, sameTime.expense) } : {}),
        },
      };
    },
  }),
  update: defineTool({
    title: '修改账目',
    description: 'Change one entry by id (from list or add): amount, type, category, account, note or time. Only the given fields change.',
    input: inputs.update,
    effect: 'write',
    execute: async (input, ctx) => {
      const settings = await loadSettings(ctx.kv);
      const { before, after } = await patch(ctx.kv, input.id, (e) => {
        const t = input.type ?? e.type;
        const next: Entry = { ...e, type: t };
        if (input.amount != null) next.amount = round2(input.amount);
        if (input.category) next.category = categoryOf(settings, input.category, t, true);
        else if (t !== e.type) next.category = OTHER[t];
        if (input.account === null) delete next.account;
        else if (input.account) next.account = accountOf(input.account);
        if (input.note === null || input.note?.trim() === '') delete next.note;
        else if (input.note) next.note = input.note.trim();
        if (input.when) next.at = parseWhen(input.when);
        return next;
      });
      return { before: view(before, settings.categories), after: view(after, settings.categories) };
    },
  }),
  delete: defineTool({
    title: '删除账目',
    description: 'Delete entries by id (find ids with list). Tell the user what was deleted.',
    input: inputs.delete,
    effect: 'write',
    execute: async ({ ids }, ctx) => {
      const settings = await loadSettings(ctx.kv);
      const removed = await remove(ctx.kv, ids);
      return { deleted: removed.map((e) => view(e, settings.categories)), notFound: ids.filter((id) => !removed.some((e) => e.id === id)) };
    },
  }),
  budgetSet: defineTool({
    title: '设置预算',
    description: 'Set or remove the monthly spending budget (total) and/or one expense category’s monthly budget (category + amount). 0 or null removes. Returns this month’s budget status.',
    input: inputs.budgetSet,
    effect: 'write',
    execute: async (input, ctx) => {
      if (input.total === undefined && !input.category) throw new Error('给出 total（总预算）或 category + amount（分类预算）');
      let catId: string | undefined;
      if (input.category) {
        const c = resolveCategory((await loadSettings(ctx.kv)).categories, input.category, 'expense');
        if (!c) throw new Error(`没有「${input.category}」这个支出分类`);
        if (input.amount === undefined) throw new Error('分类预算需要 amount（元，0 表示取消）');
        catId = c.id;
      }
      const settings = await saveSettings(ctx.kv, (s) => {
        if (input.total !== undefined) s.budgets.total = input.total ? round2(input.total) : undefined;
        if (catId) {
          if (input.amount) s.budgets.categories[catId] = round2(input.amount);
          else delete s.budgets.categories[catId];
        }
      });
      const m = monthKey(Date.now());
      const { start, end } = monthBounds(m);
      return budgetStatus(await loadRange(ctx.kv, start, end), m, settings);
    },
  }),
  budgetStatus: defineTool({
    title: '预算进度',
    description: 'Budget status of a month (default this month): per budget the amount, spent, remaining, percent, share of the month elapsed, projected month-end spending, status (ok / ahead = spending faster than the month passes / over) and what is left per remaining day.',
    input: inputs.budgetStatus,
    effect: 'read',
    execute: async ({ month }, ctx) => {
      const m = month ?? monthKey(Date.now());
      const { start, end } = monthBounds(m);
      const settings = await loadSettings(ctx.kv);
      const s = budgetStatus(await loadRange(ctx.kv, start, end), m, settings);
      return s.lines.length ? s : { ...s, note: '还没有设置预算（budgetSet）' };
    },
  }),
  categories: defineTool({
    title: '查看分类',
    description: 'The user’s categories (names to use in add), by type. Hidden ones only with includeHidden.',
    input: inputs.categories,
    effect: 'read',
    execute: async ({ type: t, includeHidden }, ctx) => {
      const settings = await loadSettings(ctx.kv);
      const list = settings.categories.filter((c) => (!t || c.type === t) && (includeHidden || !c.hidden));
      return { categories: list.map((c) => ({ name: categoryName(c), type: c.type, ...(c.hidden ? { hidden: true } : {}), ...(c.custom ? { custom: true } : {}) })) };
    },
  }),
  categoryEdit: defineTool({
    title: '管理分类',
    description: 'Add a category (name, type, optional icon), rename one, or hide / show one. Hidden categories keep their entries but leave the pickers. Only when the user asks.',
    input: inputs.categoryEdit,
    effect: 'write',
    execute: async (input, ctx) => {
      let result: Category | undefined;
      await saveSettings(ctx.kv, (s) => {
        if (input.action === 'add') {
          if (!input.name) throw new Error('新分类需要 name');
          const t = input.type ?? 'expense';
          const dup = resolveCategory(s.categories, input.name, t);
          if (dup) {
            // Adding a hidden one again shows it.
            dup.hidden = false;
            result = dup;
            return;
          }
          result = { id: `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, type: t, icon: input.icon ?? 'more', name: input.name, custom: true };
          // Before the type's 其他, which stays last in the grid.
          const otherAt = s.categories.findIndex((c) => c.id === OTHER[t]);
          s.categories.splice(otherAt < 0 ? s.categories.length : otherAt, 0, result);
          return;
        }
        if (!input.category) throw new Error('需要 category（要修改的分类）');
        const c = resolveCategory(s.categories, input.category, input.type);
        if (!c) throw new Error(`没有「${input.category}」这个分类`);
        if (input.action === 'rename') {
          if (!input.name) throw new Error('改名需要 name');
          const clash = resolveCategory(s.categories, input.name, c.type);
          if (clash && clash.id !== c.id) throw new Error(`已经有「${input.name}」了`);
          c.name = input.name;
        } else if (c.id === OTHER[c.type] && input.action === 'hide') throw new Error('「其他」不能隐藏');
        else c.hidden = input.action === 'hide';
        result = c;
      });
      return { category: result ? { name: categoryName(result), type: result.type, hidden: !!result.hidden } : null };
    },
  }),
};

