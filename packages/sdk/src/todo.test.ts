import { describe, expect, test } from 'bun:test';

import { firstDue, groupTodos, nextTodoInstance, repeatRuleOf, todoGroup, todoRepeat, todosForView, type Todo } from './todo';
import { eachZone } from './testing';

// eachZone runs every suite under 'device', +08:00 and -08:00; its `at` is clock.at in that zone.
const todo = (over: Partial<Todo> = {}): Todo => ({ id: 'x', title: 't', notes: null, dueAt: null, doneAt: null, jobId: null, createdAt: 0, ...over });

eachZone((at) => {
  describe('todoRepeat', () => {
    test('anchors at the due day and takes its time of day', () => {
      const r = todoRepeat({ unit: 'week', interval: 1, weekdays: [1] }, at(2026, 11, 9, 18, 0)); // Monday
      expect(r).toEqual({ type: 'every', unit: 'week', interval: 1, times: ['18:00'], weekdays: [1], startAt: at(2026, 11, 9), count: undefined, until: undefined });
      expect(repeatRuleOf(r)).toEqual({ unit: 'week', interval: 1, weekdays: [1], count: undefined, until: undefined });
    });

    test('week without weekdays uses the due weekday; day has none', () => {
      expect(todoRepeat({ unit: 'week', interval: 2 }, at(2026, 11, 11, 9)).weekdays).toEqual([3]);
      expect(todoRepeat({ unit: 'day', interval: 3, weekdays: [1] }, at(2026, 11, 11, 9)).weekdays).toBeUndefined();
    });
  });

  describe('nextTodoInstance', () => {
    // Every Monday 18:00. Built per test: todoRepeat reads the clock zone, which is set only while tests run.
    const weekly = () => todoRepeat({ unit: 'week', interval: 1, weekdays: [1] }, at(2026, 11, 9, 18));

    test('no repeat, no next', () => {
      expect(nextTodoInstance({ dueAt: at(2026, 11, 9, 18), repeat: null }, null, at(2026, 11, 9))).toBeNull();
    });

    test('completed early: the next occurrence after the due time', () => {
      expect(nextTodoInstance({ dueAt: at(2026, 11, 9, 18), repeat: weekly() }, null, at(2026, 11, 9, 10))).toEqual({ dueAt: at(2026, 11, 16, 18), remind: null });
    });

    test('completed late: skips occurrences already in the past', () => {
      expect(nextTodoInstance({ dueAt: at(2026, 11, 9, 18), repeat: weekly() }, null, at(2026, 11, 24, 9))?.dueAt).toBe(at(2026, 11, 30, 18));
    });

    test('every 3 days', () => {
      const r = todoRepeat({ unit: 'day', interval: 3 }, at(2026, 11, 5, 21, 30));
      expect(nextTodoInstance({ dueAt: at(2026, 11, 5, 21, 30), repeat: r }, null, at(2026, 11, 5, 20))?.dueAt).toBe(at(2026, 11, 8, 21, 30));
    });

    test('carries a one-shot reminder lead time; drops one already past', () => {
      const due = at(2026, 11, 9, 18);
      const remind = { type: 'at' as const, at: due - 30 * 60_000 };
      expect(nextTodoInstance({ dueAt: due, repeat: weekly() }, remind, at(2026, 11, 9, 10))?.remind).toEqual({ type: 'at', at: at(2026, 11, 16, 17, 30) });
      const daily = todoRepeat({ unit: 'day', interval: 1 }, due);
      // Next due tomorrow 18:00 but its reminder lead is 2 days: would be in the past.
      expect(nextTodoInstance({ dueAt: due, repeat: daily }, { type: 'at', at: due - 2 * 86_400_000 }, at(2026, 11, 9, 10))?.remind).toBeNull();
    });

    test('repeating reminders are not copied', () => {
      const due = at(2026, 11, 9, 18);
      const every = todoRepeat({ unit: 'day', interval: 1 }, due);
      expect(nextTodoInstance({ dueAt: due, repeat: weekly() }, every, at(2026, 11, 9, 10))?.remind).toBeNull();
    });

    test('a bounded series stops', () => {
      const r = todoRepeat({ unit: 'day', interval: 1, count: 2 }, at(2026, 11, 5, 9));
      expect(nextTodoInstance({ dueAt: at(2026, 11, 5, 9), repeat: r }, null, at(2026, 11, 5, 8))?.dueAt).toBe(at(2026, 11, 6, 9));
      expect(nextTodoInstance({ dueAt: at(2026, 11, 6, 9), repeat: r }, null, at(2026, 11, 6, 8))).toBeNull();
      const u = todoRepeat({ unit: 'week', interval: 1, until: at(2026, 11, 20) }, at(2026, 11, 9, 18));
      expect(nextTodoInstance({ dueAt: at(2026, 11, 16, 18), repeat: u }, null, at(2026, 11, 16))).toBeNull();
    });

    test('across a month end', () => {
      const r = todoRepeat({ unit: 'day', interval: 1 }, at(2026, 11, 30, 8));
      expect(nextTodoInstance({ dueAt: at(2026, 11, 30, 8), repeat: r }, null, at(2026, 11, 30, 7))?.dueAt).toBe(at(2026, 12, 1, 8));
    });
  });

  describe('firstDue', () => {
    test('next matching weekday at 09:00 by default', () => {
      expect(firstDue({ unit: 'week', interval: 1, weekdays: [1] }, at(2026, 11, 5, 12))).toBe(at(2026, 11, 9, 9)); // Thu → Mon
    });
    test('daily: today if the time is still ahead, else tomorrow', () => {
      expect(firstDue({ unit: 'day', interval: 1 }, at(2026, 11, 5, 8))).toBe(at(2026, 11, 5, 9));
      expect(firstDue({ unit: 'day', interval: 1 }, at(2026, 11, 5, 12), '21:00')).toBe(at(2026, 11, 5, 21));
      expect(firstDue({ unit: 'day', interval: 1 }, at(2026, 11, 5, 22), '21:00')).toBe(at(2026, 11, 6, 21));
    });
  });

  describe('groups and views', () => {
    const now = at(2026, 11, 5, 12);
    const list = [
      todo({ id: 'late', dueAt: at(2026, 11, 4, 18) }),
      todo({ id: 'today', dueAt: at(2026, 11, 5, 20) }),
      todo({ id: 'todayHigh', dueAt: at(2026, 11, 5, 20), priority: 'high' }),
      todo({ id: 'later', dueAt: at(2026, 11, 6, 0) }),
      todo({ id: 'undated', createdAt: 1 }),
      todo({ id: 'undatedHigh', priority: 'high', createdAt: 2 }),
      todo({ id: 'done', dueAt: at(2026, 11, 5, 9), doneAt: at(2026, 11, 5, 10) }),
    ];
    const ids = (l: Todo[]) => l.map((t) => t.id);

    test('todoGroup boundaries: midnight starts upcoming', () => {
      expect(todoGroup({ dueAt: at(2026, 11, 5, 23, 59), doneAt: null }, now)).toBe('today');
      expect(todoGroup({ dueAt: at(2026, 11, 6), doneAt: null }, now)).toBe('upcoming');
      expect(todoGroup({ dueAt: at(2026, 11, 5, 11), doneAt: null }, now)).toBe('overdue');
    });

    test('groupTodos sorts each group', () => {
      const g = groupTodos(list, now);
      expect(ids(g.overdue)).toEqual(['late']);
      expect(ids(g.today)).toEqual(['todayHigh', 'today']);
      expect(ids(g.upcoming)).toEqual(['later']);
      expect(ids(g.undated)).toEqual(['undatedHigh', 'undated']);
      expect(ids(g.done)).toEqual(['done']);
    });

    test('views', () => {
      expect(ids(todosForView(list, 'today', now))).toEqual(['late', 'todayHigh', 'today', 'undatedHigh']);
      expect(ids(todosForView(list, 'upcoming', now))).toEqual(['later']);
      expect(ids(todosForView(list, 'all', now))).toEqual(['late', 'todayHigh', 'today', 'later', 'undatedHigh', 'undated']);
    });
  });
});
