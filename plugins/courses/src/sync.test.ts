/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { syncDeadlines } from './api';
import { planSync, remindTime, type SyncAssignment } from './sync';

const H = 3600_000;
const now = new Date(2026, 9, 20, 12, 0).getTime();
const a = (contentId: string, deadline: number | null, submitted = false): SyncAssignment => ({ course: '高等数学', courseId: '_8_1', contentId, title: `作业${contentId}`, deadline, submitted });

test('remindTime', () => {
  expect(remindTime(now + 48 * H, 24, now)).toBe(now + 24 * H);
  expect(remindTime(now + 10 * H, 24, now)).toBe(now + 9 * H);
  expect(remindTime(now + 30 * 60_000, 24, now)).toBeNull();
});

describe('planSync', () => {
  test('adds only unsubmitted upcoming ones', () => {
    const steps = planSync([a('_1_1', now + 48 * H), a('_2_1', now + 48 * H, true), a('_3_1', now - H), a('_4_1', null)], {}, () => undefined, { now, remindHours: 24 });
    expect(steps).toEqual([{ kind: 'add', key: '_8_1:_1_1', title: '交作业：作业_1_1', notes: '高等数学 · 教学网作业', dueAt: now + 48 * H, remindAt: now + 24 * H }]);
  });

  test('re-sync: keep, update moved deadline, complete submitted, respect deletions', () => {
    const todos: Record<string, { title: string; dueAt: number | null; doneAt: number | null }> = {
      t1: { title: '交作业：作业_1_1', dueAt: now + 48 * H, doneAt: null },
      t2: { title: '交作业：作业_2_1', dueAt: now + 48 * H, doneAt: null },
      t3: { title: '交作业：作业_3_1', dueAt: now + 48 * H, doneAt: null },
    };
    const steps = planSync(
      [a('_1_1', now + 48 * H), a('_2_1', now + 72 * H), a('_3_1', now + 48 * H, true), a('_4_1', now + 48 * H), a('_5_1', now + 48 * H)],
      { '_8_1:_1_1': 't1', '_8_1:_2_1': 't2', '_8_1:_3_1': 't3', '_8_1:_4_1': null, '_8_1:_5_1': 'gone' },
      (id) => todos[id],
      { now, remindHours: 24 },
    );
    expect(steps.map((s) => [s.kind, s.key])).toEqual([
      ['keep', '_8_1:_1_1'],
      ['update', '_8_1:_2_1'],
      ['done', '_8_1:_3_1'],
    ]);
  });
});

test('syncDeadlines is idempotent against a fake todo store', async () => {
  const store = new Map<string, { id: string; title: string; dueAt: number | null; doneAt: number | null }>();
  let n = 0;
  const services = {
    todos: {
      get: (id: string) => store.get(id),
      add: async (input: { title: string; dueAt?: number | null }) => {
        const todo = { id: `t${++n}`, title: input.title, dueAt: input.dueAt ?? null, doneAt: null };
        store.set(todo.id, todo);
        return todo;
      },
      update: async (id: string, patch: { title?: string; dueAt?: number | null }) => {
        const todo = { ...store.get(id)!, ...patch };
        store.set(id, todo);
        return todo;
      },
      setDone: async (id: string, done: boolean) => {
        const todo = { ...store.get(id)!, doneAt: done ? now : null };
        store.set(id, todo);
        return todo;
      },
    },
  } as never;
  const mem = new Map<string, unknown>();
  const kv = { get: async (k: string) => mem.get(k), set: async (k: string, v: unknown) => void mem.set(k, v), delete: async (k: string) => void mem.delete(k) } as never;
  const list = [a('_1_1', now + 48 * H), a('_2_1', now + 72 * H)];
  const first = await syncDeadlines(services, kv, list, { now, remindHours: 24 });
  expect(first.added).toHaveLength(2);
  const again = await syncDeadlines(services, kv, list, { now, remindHours: 24 });
  expect(again).toEqual({ added: [], updated: [], completed: [], kept: 2 });
  expect(store.size).toBe(2);
  store.delete('t1');
  const afterDelete = await syncDeadlines(services, kv, [a('_1_1', now + 48 * H), a('_2_1', now + 72 * H, true)], { now, remindHours: 24 });
  expect(afterDelete.added).toEqual([]);
  expect(afterDelete.completed).toEqual(['交作业：作业_2_1']);
  expect(store.size).toBe(1);
});
