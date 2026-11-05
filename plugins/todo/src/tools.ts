import {
  describeTrigger,
  firstDue,
  formatLocal,
  parseLocal,
  repeatRuleOf,
  scheduleInputSchema,
  toTrigger,
  todoRepeat,
  type HostServices,
  type RepeatRule,
  type Todo,
  type TodoRepeat,
} from '@pku-harness/sdk';
import { z } from 'zod';

/** What the model sees for one to-do: local times and plain-text schedules, no epoch ms. */
export const view = (services: HostServices, t: Todo, now = Date.now()) => {
  const job = t.jobId ? services.scheduler.get(t.jobId) : undefined;
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    due: t.dueAt ? formatLocal(t.dueAt) : null,
    done: !!t.doneAt,
    overdue: !t.doneAt && t.dueAt != null && t.dueAt < now,
    priority: t.priority ?? 'none',
    repeat: t.repeat ? describeTrigger(t.repeat, now) : null,
    reminder: job ? describeTrigger(job.trigger, now) : null,
  };
};

export const remindInput = z
  .union([
    z.object({ minutesBeforeDue: z.number().int().min(0).max(7 * 24 * 60) }),
    z.object({ schedule: scheduleInputSchema }),
  ])
  .nullable()
  .optional()
  .describe('reminder: minutes before the due time (follows each instance of a repeating to-do), or any schedule; null removes it');

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}( \d{1,2}:\d{2})?$/, 'use local "YYYY-MM-DD" or "YYYY-MM-DD HH:mm"');

export const repeatInput = z
  .object({
    unit: z.enum(['day', 'week']).describe('day: every N days; week: every N weeks on `weekdays`'),
    interval: z.number().int().min(1).max(365).default(1).describe('every N units; 1 = every day / every week'),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional().describe('week: 0=Sunday, 1=Monday … 6=Saturday; default = weekday of the due date'),
    count: z.number().int().min(1).max(999).optional().describe('stop after this many instances in total'),
    until: localDate.optional().describe('no instance after this local date (inclusive)'),
  })
  .nullable()
  .optional()
  .describe(
    'make the to-do itself repeat: completing it creates the next instance at the next due time (same title, notes, priority and reminder lead). The due time of day comes from `due`. null stops repeating',
  );

export const priorityInput = z.enum(['none', 'high']).optional().describe('high = important (user says 重要/紧急/别忘了); shown flagged and in the today view');

export function toRule(r: NonNullable<z.infer<typeof repeatInput>>): RepeatRule {
  return {
    unit: r.unit,
    interval: r.interval,
    weekdays: r.unit === 'week' ? r.weekdays : undefined,
    count: r.count,
    until: r.until ? parseLocal(r.until.length === 10 ? `${r.until} 23:59` : r.until) : undefined,
  };
}

export function toRemind(r: z.infer<typeof remindInput>, dueAt: number | null) {
  if (r === undefined) return undefined;
  if (r === null) return null;
  if ('schedule' in r) return toTrigger(r.schedule);
  if (dueAt == null) throw new Error('没有截止时间，无法按「提前 N 分钟」提醒');
  return { type: 'at' as const, at: dueAt - r.minutesBeforeDue * 60_000 };
}

/**
 * Due time and repeat series for an add or an update (pure). A repeating to-do always has a due
 * time: without one, the first matching day at 09:00. Moving the due time of a repeating to-do
 * re-anchors its series on the new time; clearing the due time stops it repeating.
 */
export function resolveDue(
  cur: Pick<Todo, 'dueAt' | 'repeat'> | undefined,
  due: string | null | undefined,
  repeat: z.infer<typeof repeatInput>,
  now: number,
): { dueAt: number | null; repeat: TodoRepeat | null | undefined } {
  let dueAt = due === undefined ? (cur?.dueAt ?? null) : due ? parseLocal(due) : null;
  if (repeat) {
    const rule = toRule(repeat);
    dueAt ??= firstDue(rule, now);
    if (dueAt == null) throw new Error('这个重复规则已经没有下一次了');
    return { dueAt, repeat: todoRepeat(rule, dueAt) };
  }
  if (repeat === null) return { dueAt, repeat: null };
  // Repeat unchanged: follow a due change.
  if (cur?.repeat && due !== undefined) return { dueAt, repeat: dueAt == null ? null : todoRepeat(repeatRuleOf(cur.repeat), dueAt) };
  return { dueAt, repeat: undefined };
}
