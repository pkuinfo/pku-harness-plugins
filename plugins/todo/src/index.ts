import { definePlugin, defineTool, todosForView } from '@pku-harness/sdk';
import { z } from 'zod';

import { priorityInput, remindInput, repeatInput, resolveDue, toRemind, view } from './tools';
import { TodoWidget } from './widget';

const actorSource = (actor: string) => (actor === 'agent' ? 'agent' : 'user') as 'agent' | 'user';

export const todoPlugin = definePlugin({
  id: 'todo',
  name: '待办',
  description: '待办事项：截止时间、准时提醒、重要标记和重复待办，以及仪表盘小组件。',
  version: '0.3.0',
  i18n: {
    en: {
      name: 'To-dos',
      description: 'To-dos with due dates, on-time reminders, an important flag and repeats, plus a dashboard widget.',
      tools: {
        list: { title: 'View to-dos' },
        add: { title: 'Add to-do' },
        update: { title: 'Edit to-do' },
        complete: { title: 'Complete to-do' },
        delete: { title: 'Delete to-do' },
      },
      dataSources: { open: { title: 'Open to-dos' }, today: { title: 'To-dos for today' } },
      widgets: { today: { title: 'To-dos', description: 'What’s due today and overdue, with important ones flagged; tick items off right on the dashboard.' } },
    },
  },
  icon: 'todo',
  core: true,
  scopes: [],
  instructions: `待办用 todo 工具管理。截止时间用本地 "YYYY-MM-DD HH:mm"。
- 需要提醒时传 remind（如截止前 30 分钟 minutesBeforeDue: 30，或任意 schedule）。
- 周期性的事（"每周一交周报"、"每天背单词"、"每 3 天浇花"）建一个重复待办：repeat { unit: 'week', weekdays: [1] } / { unit: 'day', interval: 1 } / { unit: 'day', interval: 3 }，due 写第一次的截止时间（没说时间就挑合理的，比如周报 18:00）。不要为每一次各建一个待办，也不要用重复提醒代替。完成后会自动生成下一次。
- 用户说"重要"、"紧急"、"千万别忘" → priority: 'high'。
- 问"今天要做什么" 用 list { view: 'today' }（逾期 + 今天到期 + 无日期的重要事项）；"接下来" 用 view: 'upcoming'。
- 用户想在仪表盘看待办时，用 dashboard 的插件小组件 todo/today。`,
  dataSources: {
    open: { title: '未完成的待办', tool: 'list', ttlMs: 0 },
    today: { title: '今天的待办', tool: 'list', args: { view: 'today' }, ttlMs: 0 },
  },
  contributes: {
    widgets: {
      today: {
        title: '待办',
        description: '今天到期和已逾期的待办，重要的带旗标；可以直接在仪表盘上勾选完成。',
        sizes: ['sm', 'md'],
        defaultSize: 'md',
        component: TodoWidget,
      },
    },
  },
  tools: {
    list: defineTool({
      title: '查看待办',
      description:
        "List to-dos. view 'today' = overdue + due today + undated high-priority ones; 'upcoming' = due after today; 'all' (default) = every open one. Each item has due, overdue, priority ('none'|'high'), repeat (text, or null) and reminder. includeDone appends finished ones (newest first).",
      input: z.object({
        view: z.enum(['today', 'upcoming', 'all']).optional(),
        includeDone: z.boolean().optional(),
      }),
      effect: 'read',
      execute: async ({ view: v, includeDone }, ctx) => {
        const now = Date.now();
        const all = ctx.services.todos.list();
        const open = todosForView(all, v ?? 'all', now);
        const done = includeDone ? all.filter((t) => t.doneAt).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)) : [];
        return [...open, ...done].map((t) => view(ctx.services, t, now));
      },
    }),
    add: defineTool({
      title: '添加待办',
      description: 'Add a to-do with optional notes, due time, reminder, priority and repeat. For anything recurring, add ONE repeating to-do (repeat), not one per occurrence.',
      input: z.object({
        title: z.string().min(1),
        notes: z.string().optional(),
        due: z.string().optional().describe('local "YYYY-MM-DD HH:mm"; for a repeating to-do, the first instance'),
        remind: remindInput,
        priority: priorityInput,
        repeat: repeatInput,
      }),
      effect: 'write',
      execute: async ({ title, notes, due, remind, priority, repeat }, ctx) => {
        const r = resolveDue(undefined, due, repeat, Date.now());
        const todo = await ctx.services.todos.add(
          { title, notes, dueAt: r.dueAt, remind: toRemind(remind, r.dueAt), priority, repeat: r.repeat ?? null },
          actorSource(ctx.actor),
        );
        return view(ctx.services, todo);
      },
    }),
    update: defineTool({
      title: '修改待办',
      description: 'Change a to-do. Only pass what changes; due: null clears the due time (and stops a repeat); repeat: null stops repeating; priority none/high.',
      input: z.object({
        id: z.string(),
        title: z.string().optional(),
        notes: z.string().nullable().optional(),
        due: z.string().nullable().optional(),
        remind: remindInput,
        priority: priorityInput,
        repeat: repeatInput,
      }),
      effect: 'write',
      execute: async ({ id, title, notes, due, remind, priority, repeat }, ctx) => {
        const cur = ctx.services.todos.get(id);
        if (!cur) throw new Error(`没有这个待办：${id}`);
        const r = resolveDue(cur, due, repeat, Date.now());
        const todo = await ctx.services.todos.update(
          id,
          { title, notes, dueAt: r.dueAt === cur.dueAt ? undefined : r.dueAt, remind: toRemind(remind, r.dueAt), priority, repeat: r.repeat },
          actorSource(ctx.actor),
        );
        return view(ctx.services, todo);
      },
    }),
    complete: defineTool({
      title: '完成待办',
      description: 'Mark a to-do done (or not done with done: false). Done pauses its reminder. Completing a repeating to-do creates the next instance, returned as `next`.',
      input: z.object({ id: z.string(), done: z.boolean().optional() }),
      effect: 'write',
      execute: async ({ id, done }, ctx) => {
        const todo = await ctx.services.todos.setDone(id, done ?? true);
        const next = todo.doneAt && todo.nextId ? ctx.services.todos.get(todo.nextId) : undefined;
        return { ...view(ctx.services, todo), ...(next ? { next: view(ctx.services, next) } : {}) };
      },
    }),
    delete: defineTool({
      title: '删除待办',
      description: 'Delete a to-do and its reminder (only this instance of a repeating one).',
      input: z.object({ id: z.string() }),
      effect: 'write',
      execute: async ({ id }, ctx) => {
        const t = ctx.services.todos.get(id);
        if (!t) throw new Error(`没有这个待办：${id}`);
        await ctx.services.todos.remove(id);
        return { deleted: t.title };
      },
    }),
  },
});
