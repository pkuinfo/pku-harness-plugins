import { describe, expect, test } from 'bun:test';

import { changes, getEntry, insert, loadAll, loadMonth, loadSettings, months, patch, remove, saveSettings } from './store';
import { memoryKV } from './test-kv';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const base = { type: 'expense' as const, amount: 10, category: 'food' };

describe('month buckets', () => {
  test('entries land in their local month, newest first, with a month index', async () => {
    const kv = memoryKV();
    await insert(kv, [
      { ...base, at: at(2026, 11, 1) },
      { ...base, at: at(2026, 10, 31, 23) },
      { ...base, at: at(2026, 11, 3) },
    ]);
    expect(await months(kv)).toEqual(['2026-10', '2026-11']);
    expect((await loadMonth(kv, '2026-11')).map((e) => new Date(e.at).getDate())).toEqual([3, 1]);
    expect(await loadMonth(kv, '2026-10')).toHaveLength(1);
    expect([...kv.data.keys()].sort()).toEqual(['months', 'tx:2026-10', 'tx:2026-11']);
  });

  test('editing the time moves an entry between months; emptied months leave the index', async () => {
    const kv = memoryKV();
    const { added } = await insert(kv, [{ ...base, at: at(2026, 10, 15) }]);
    const id = added[0].id;
    expect(id.startsWith('202610')).toBe(true);
    await patch(kv, id, (e) => ({ ...e, at: at(2026, 11, 2), amount: 12 }));
    expect(await months(kv)).toEqual(['2026-11']);
    expect(kv.data.has('tx:2026-10')).toBe(false);
    expect(await getEntry(kv, id)).toMatchObject({ id, amount: 12 });
    await expect(patch(kv, 'nope', (e) => e)).rejects.toThrow('没有这笔记录');
  });

  test('remove several, incl. two from one month', async () => {
    const kv = memoryKV();
    const { added } = await insert(kv, [1, 2, 3].map((d) => ({ ...base, at: at(2026, 11, d) })));
    const removed = await remove(kv, [added[0].id, added[2].id, 'missing']);
    expect(removed).toHaveLength(2);
    expect((await loadAll(kv)).map((e) => e.id)).toEqual([added[1].id]);
  });
});

describe('import dedupe', () => {
  test('same externalId is skipped within a batch and across imports', async () => {
    const kv = memoryKV();
    const row = (id: string, d: number) => ({ ...base, at: at(2026, 11, d), externalId: id, source: 'import' as const });
    expect(await insert(kv, [row('a', 1), row('b', 2), row('a', 1)])).toMatchObject({ skipped: 1 });
    const again = await insert(kv, [row('a', 1), row('b', 2), row('c', 3)]);
    expect(again.skipped).toBe(2);
    expect(again.added.map((e) => e.externalId)).toEqual(['c']);
    expect(await loadAll(kv)).toHaveLength(3);
  });
});

describe('settings and change notifications', () => {
  test('defaults, built-ins added later appear, writes notify', async () => {
    const kv = memoryKV();
    expect((await loadSettings(kv)).categories).toHaveLength(18);
    await kv.set('settings', { categories: [{ id: 'food', type: 'expense', icon: 'food', name: '吃饭' }], budgets: {} });
    const s = await loadSettings(kv);
    expect(s.categories[0].name).toBe('吃饭');
    expect(s.categories).toHaveLength(18);
    expect(s.budgets.categories).toEqual({});
    let heard = 0;
    const off = changes.subscribe(() => heard++);
    await saveSettings(kv, (x) => void (x.budgets.total = 900));
    await insert(kv, [{ ...base, at: at(2026, 11, 1) }]);
    off();
    expect(heard).toBe(2);
    expect((await loadSettings(kv)).budgets.total).toBe(900);
  });

  test('concurrent writes do not lose entries', async () => {
    const kv = memoryKV();
    await Promise.all(Array.from({ length: 20 }, (_, i) => insert(kv, [{ ...base, amount: i + 1, at: at(2026, 11, 1) }])));
    expect(await loadMonth(kv, '2026-11')).toHaveLength(20);
  });
});
