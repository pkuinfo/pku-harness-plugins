import type { KV } from '@pku-harness/sdk';

import { defaultSettings, DEFAULT_CATEGORIES, type Entry, type Settings } from './model';
import { monthKey, monthsOfRange } from './time';

/**
 * The ledger's kv layout (see model.ts). All writes go through one queue, so a screen save and
 * an agent's batch import never interleave read-modify-write cycles; every change bumps a
 * version that screens and widgets subscribe to (useLedger), so they redraw at once whether the
 * user or the agent wrote.
 */

const TX = (month: string) => `tx:${month}`;
const MONTHS = 'months';
const SETTINGS = 'settings';

let version = 0;
const listeners = new Set<() => void>();
export const changes = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  version: () => version,
};
function changed() {
  version++;
  listeners.forEach((l) => l());
}

let queue: Promise<unknown> = Promise.resolve();
/** Run `fn` after every earlier write has finished. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export async function loadSettings(kv: KV): Promise<Settings> {
  const s = await kv.get<Settings>(SETTINGS);
  if (!s) return defaultSettings();
  // Built-ins added in a later version show up for existing users too.
  const have = new Set(s.categories.map((c) => c.id));
  const missing = DEFAULT_CATEGORIES.filter((c) => !have.has(c.id)).map((c) => ({ ...c }));
  return { categories: [...s.categories, ...missing], budgets: { ...s.budgets, categories: s.budgets?.categories ?? {} } };
}

export function saveSettings(kv: KV, update: (s: Settings) => Settings | void): Promise<Settings> {
  return serial(async () => {
    const before = await loadSettings(kv);
    const draft = JSON.parse(JSON.stringify(before)) as Settings;
    const next = update(draft) ?? draft;
    await kv.set(SETTINGS, next);
    changed();
    return next;
  });
}

export async function months(kv: KV): Promise<string[]> {
  return (await kv.get<string[]>(MONTHS)) ?? [];
}

export async function loadMonth(kv: KV, month: string): Promise<Entry[]> {
  return (await kv.get<Entry[]>(TX(month))) ?? [];
}

/** Entries of the months a [start, end) range touches (not filtered to the range). */
export async function loadRange(kv: KV, start: number, end: number): Promise<Entry[]> {
  const have = new Set(await months(kv));
  const keys = monthsOfRange(start, end).filter((m) => have.has(m));
  return (await Promise.all(keys.map((m) => loadMonth(kv, m)))).flat();
}

/** Every entry (all months). */
export async function loadAll(kv: KV): Promise<Entry[]> {
  return (await Promise.all((await months(kv)).map((m) => loadMonth(kv, m)))).flat();
}

const byNewest = (a: Entry, b: Entry) => b.at - a.at;

async function writeMonths(kv: KV, touched: Map<string, Entry[]>) {
  const index = new Set(await months(kv));
  for (const [m, list] of touched) {
    list.sort(byNewest);
    if (list.length) {
      await kv.set(TX(m), list);
      index.add(m);
    } else {
      await kv.delete(TX(m));
      index.delete(m);
    }
  }
  await kv.set(MONTHS, [...index].sort());
}

export function newId(at: number): string {
  return `${monthKey(at).replace('-', '')}${Math.random().toString(36).slice(2, 8)}${(Date.now() % 1296).toString(36)}`;
}

/**
 * Append entries. Entries whose `externalId` already exists in their month (or earlier in the
 * same batch) are skipped, so re-importing the same campus-card transactions is harmless.
 */
export function insert(kv: KV, entries: Omit<Entry, 'id'>[]): Promise<{ added: Entry[]; skipped: number }> {
  return serial(async () => {
    const touched = new Map<string, Entry[]>();
    const seen = new Map<string, Set<string>>();
    const added: Entry[] = [];
    let skipped = 0;
    for (const e of entries) {
      const m = monthKey(e.at);
      if (!touched.has(m)) {
        const list = await loadMonth(kv, m);
        touched.set(m, list);
        seen.set(m, new Set(list.map((x) => x.externalId).filter((x): x is string => !!x)));
      }
      const ids = seen.get(m)!;
      if (e.externalId && ids.has(e.externalId)) {
        skipped++;
        continue;
      }
      if (e.externalId) ids.add(e.externalId);
      const entry: Entry = { id: newId(e.at), ...e };
      touched.get(m)!.push(entry);
      added.push(entry);
    }
    if (added.length) {
      await writeMonths(kv, touched);
      changed();
    }
    return { added, skipped };
  });
}

async function locate(kv: KV, id: string): Promise<{ month: string; list: Entry[]; index: number } | null> {
  const all = await months(kv);
  // Ids start with the month they were created in: look there first.
  const hint = /^(\d{4})(\d{2})/.exec(id);
  const order = hint ? [`${hint[1]}-${hint[2]}`, ...all.filter((m) => m !== `${hint[1]}-${hint[2]}`).reverse()] : [...all].reverse();
  for (const m of order) {
    if (!all.includes(m)) continue;
    const list = await loadMonth(kv, m);
    const index = list.findIndex((e) => e.id === id);
    if (index >= 0) return { month: m, list, index };
  }
  return null;
}

export async function getEntry(kv: KV, id: string): Promise<Entry | null> {
  const hit = await locate(kv, id);
  return hit ? hit.list[hit.index] : null;
}

/** Change an entry; moving it to another month moves it between buckets. */
export function patch(kv: KV, id: string, fn: (e: Entry) => Entry): Promise<{ before: Entry; after: Entry }> {
  return serial(async () => {
    const hit = await locate(kv, id);
    if (!hit) throw new Error(`没有这笔记录：${id}`);
    const before = hit.list[hit.index];
    const after = { ...fn({ ...before }), id };
    const touched = new Map<string, Entry[]>([[hit.month, hit.list]]);
    const to = monthKey(after.at);
    if (to === hit.month) hit.list[hit.index] = after;
    else {
      hit.list.splice(hit.index, 1);
      const dest = await loadMonth(kv, to);
      dest.push(after);
      touched.set(to, dest);
    }
    await writeMonths(kv, touched);
    changed();
    return { before, after };
  });
}

export function remove(kv: KV, ids: string[]): Promise<Entry[]> {
  return serial(async () => {
    const removed: Entry[] = [];
    const touched = new Map<string, Entry[]>();
    for (const id of ids) {
      const hit = await locate(kv, id);
      if (!hit) continue;
      // Reuse a month already edited in this call so earlier removals stick.
      const list = touched.get(hit.month) ?? hit.list;
      const i = list.findIndex((e) => e.id === id);
      if (i < 0) continue;
      removed.push(list[i]);
      list.splice(i, 1);
      touched.set(hit.month, list);
    }
    if (removed.length) {
      await writeMonths(kv, touched);
      changed();
    }
    return removed;
  });
}
