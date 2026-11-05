import { describe, expect, test } from 'bun:test';

import { loadAll } from './store';
import { ctxOf, memoryKV } from './test-kv';
import { inputs, tools } from './tools';
import { dayKey, monthKey } from './time';

const run = (kv: ReturnType<typeof memoryKV>, name: string, input: unknown, actor: 'agent' | 'user' = 'agent') => tools[name].execute(tools[name].input.parse(input), ctxOf(kv, actor)) as Promise<any>;

describe('input validation', () => {
  test('amounts: positive, two decimals, sane size', () => {
    expect(inputs.add.safeParse({ amount: 18 }).success).toBe(true);
    expect(inputs.add.safeParse({ amount: 18.55 }).success).toBe(true);
    expect(inputs.add.safeParse({ amount: 0 }).success).toBe(false);
    expect(inputs.add.safeParse({ amount: -5 }).success).toBe(false);
    expect(inputs.add.safeParse({ amount: 1.234 }).success).toBe(false);
    expect(inputs.add.safeParse({ amount: 13800138000 }).success).toBe(false);
    expect(inputs.add.safeParse({ amount: 5, type: 'transfer' }).success).toBe(false);
  });
  test('dates and limits', () => {
    expect(inputs.list.safeParse({ from: '2026-11-01', to: '2026-11-31' }).success).toBe(false);
    expect(inputs.summary.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(inputs.list.safeParse({ limit: 500 }).success).toBe(false);
    expect(inputs.delete.safeParse({ ids: [] }).success).toBe(false);
    expect(inputs.addMany.safeParse({ entries: [] }).success).toBe(false);
    expect(inputs.categoryEdit.safeParse({ action: 'add', name: '一个特别长的分类名字' }).success).toBe(false);
  });
  test('every effect is honest', () => {
    const effects = Object.fromEntries(Object.entries(tools).map(([k, t]) => [k, t.effect]));
    expect(effects).toEqual({ add: 'write', addMany: 'write', list: 'read', summary: 'read', update: 'write', delete: 'write', budgetSet: 'write', budgetStatus: 'read', categories: 'read', categoryEdit: 'write' });
  });
});

describe('tools end to end', () => {
  test('add from natural fields, names in either language, source by actor', async () => {
    const kv = memoryKV();
    const r = await run(kv, 'add', { amount: 18, category: '餐饮', note: '午饭' });
    expect(r.recorded).toMatchObject({ type: 'expense', amount: 18, category: '餐饮', account: '未指定', note: '午饭', source: 'agent' });
    expect(r.month).toMatchObject({ month: monthKey(Date.now()), expense: 18 });
    const inc = await run(kv, 'add', { type: 'income', amount: 5000, category: 'Scholarships', account: '微信' }, 'user');
    expect(inc.recorded).toMatchObject({ category: '奖助学金', account: '微信' });
    expect(inc.recorded.source).toBeUndefined();
    await expect(run(kv, 'add', { amount: 3, category: '奶茶' })).rejects.toThrow('没有「奶茶」');
    await expect(run(kv, 'add', { amount: 3, account: '花呗' })).rejects.toThrow('没有「花呗」这个账户');
    expect((await run(kv, 'add', { amount: 3 })).recorded.category).toBe('其他');
  });

  test('addMany imports campus-card rows once', async () => {
    const kv = memoryKV();
    const rows = [
      { amount: 12.5, category: '餐饮', account: '校园卡', note: '学一食堂', when: '2026-11-03 12:01', externalId: 'card:2026-11-03 12:01:-12.5:学一食堂' },
      { amount: 6, category: '饮品', account: '校园卡', note: '咖啡', when: '2026-11-03 15:00', externalId: 'card:2' },
    ];
    expect(await run(kv, 'addMany', { entries: rows })).toEqual({ added: 2, skippedDuplicates: 0, addedExpense: 18.5, addedIncome: 0, unknownCategoriesAsOther: ['饮品'] });
    expect(await run(kv, 'addMany', { entries: rows })).toMatchObject({ added: 0, skippedDuplicates: 2 });
    const all = await loadAll(kv);
    expect(all.every((e) => e.source === 'import' && e.account === 'campus-card')).toBe(true);
  });

  test('list, update, delete', async () => {
    const kv = memoryKV();
    const today = dayKey(Date.now());
    await run(kv, 'add', { amount: 18, category: '餐饮', note: '午饭', when: today });
    await run(kv, 'add', { amount: 32, category: '交通', note: '打车' });
    const l = await run(kv, 'list', { keyword: '打车' });
    expect(l.items).toHaveLength(1);
    expect(l.totals.expense).toBe(32);
    const id = l.items[0].id;
    const u = await run(kv, 'update', { id, amount: 30, account: 'alipay', note: null });
    expect(u.before).toMatchObject({ amount: 32, note: '打车' });
    expect(u.after).toMatchObject({ amount: 30, account: '支付宝', note: null });
    expect((await run(kv, 'list', { category: '交通' })).items[0].amount).toBe(30);
    expect(await run(kv, 'delete', { ids: [id, 'x'] })).toMatchObject({ deleted: [{ id }], notFound: ['x'] });
    expect((await run(kv, 'list', {})).items).toHaveLength(1);
  });

  test('summary: totals, categories, series, previous period', async () => {
    const kv = memoryKV();
    await run(kv, 'addMany', {
      source: 'agent',
      entries: [
        { amount: 100, category: '购物', when: '2025-12-10' },
        { amount: 20, category: '餐饮', when: '2026-01-02' },
        { amount: 30.5, category: '餐饮', when: '2026-01-20' },
        { amount: 1500, type: 'income', category: '生活费', when: '2026-01-01' },
      ],
    });
    const s = await run(kv, 'summary', { month: '2026-01' });
    expect(s).toMatchObject({ income: 1500, expense: 50.5, net: 1449.5, count: 3, period: { label: '2026-01', from: '2026-01-01', to: '2026-01-31', ongoing: false } });
    expect(s.expenseByCategory).toEqual([{ category: 'food', name: '餐饮', amount: 50.5, share: 1, count: 2 }]);
    expect(s.series.unit).toBe('day');
    expect(s.series.points.map((p: { key: string }) => p.key)).toEqual(['2026-01-01', '2026-01-02', '2026-01-20']);
    expect(s.top.map((e: { amount: number }) => e.amount)).toEqual([30.5, 20]);
    expect(s.previous).toEqual({ label: '2025-12', expense: 100, income: 0, expenseChange: -0.495 });
    const y = await run(kv, 'summary', { period: 'year', year: 2026 });
    expect(y.series.unit).toBe('month');
    expect(y.previous.expense).toBe(100);
  });

  test('budgets and categories', async () => {
    const kv = memoryKV();
    await run(kv, 'add', { amount: 80, category: '餐饮' });
    const set = await run(kv, 'budgetSet', { total: 1000 });
    expect(set.lines[0]).toMatchObject({ scope: 'total', budget: 1000, spent: 80 });
    await run(kv, 'budgetSet', { category: '餐饮', amount: 50 });
    const alert = await run(kv, 'add', { amount: 1, category: '餐饮' });
    expect(alert.budgetAlerts).toEqual([{ name: '餐饮', budget: 50, spent: 81, remaining: -31, status: 'over' }]);
    await run(kv, 'budgetSet', { category: 'food', amount: 0 });
    expect((await run(kv, 'budgetStatus', {})).lines.map((l: { scope: string }) => l.scope)).toEqual(['total']);
    await expect(run(kv, 'budgetSet', {})).rejects.toThrow('total');

    expect((await run(kv, 'categoryEdit', { action: 'add', name: '奶茶', icon: 'drop' })).category).toEqual({ name: '奶茶', type: 'expense', hidden: false });
    expect((await run(kv, 'add', { amount: 15, category: '奶茶' })).recorded.category).toBe('奶茶');
    await run(kv, 'categoryEdit', { action: 'rename', category: '奶茶', name: '饮品' });
    await run(kv, 'categoryEdit', { action: 'hide', category: '人情' });
    await expect(run(kv, 'categoryEdit', { action: 'hide', category: '其他', type: 'expense' })).rejects.toThrow('不能隐藏');
    await expect(run(kv, 'categoryEdit', { action: 'rename', category: '饮品', name: '餐饮' })).rejects.toThrow('已经有');
    const names = (await run(kv, 'categories', { type: 'expense' })).categories.map((c: { name: string }) => c.name);
    expect(names).toContain('饮品');
    expect(names).not.toContain('人情');
    // The new category sits before 其他, which stays last.
    expect(names.slice(-2)).toEqual(['饮品', '其他']);
  });
});
