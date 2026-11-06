import { at, parts, startOfDay } from './clock';
import { nextOccurrence } from './scheduler/recurrence';
import type { Trigger } from './scheduler/types';

/** 'high' = flagged as important (shown in "today" even without a due time). */
export type TodoPriority = 'none' | 'high';

/**
 * How a to-do repeats: an ordinary scheduler series (`every`, unit day or week) whose
 * occurrences are the due times of successive instances. `times` holds the due time of day,
 * `startAt` anchors the series (so `count` / `until` bound it across instances). Wall-clock
 * time in the app's clock zone (`clock.ts`), like the rest of the scheduler.
 */
export type TodoRepeat = Extract<Trigger, { type: 'every' }>;

export type Todo = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: number | null;
  doneAt: number | null;
  /** Reminder job in the scheduler, if any. */
  jobId: string | null;
  createdAt: number;
  /** Absent on data written before priorities existed: treat as 'none'. */
  priority?: TodoPriority;
  /** Repeating to-do: completing it creates the next instance. */
  repeat?: TodoRepeat | null;
  /** The instance created when this repeating to-do was completed (undone together). */
  nextId?: string | null;
};

export type TodoInput = {
  title: string;
  notes?: string | null;
  dueAt?: number | null;
  /** When to remind; null = no reminder. A trigger allows repeating reminders. */
  remind?: Trigger | null;
  priority?: TodoPriority;
  /** null = stop repeating. A repeating to-do needs a due time (the first matching one is used). */
  repeat?: TodoRepeat | null;
};

/** The user-facing part of a repeat rule, without its anchor (forms and tools edit this). */
export type RepeatRule = {
  unit: 'day' | 'week';
  /** Every N days / weeks. */
  interval: number;
  /** week unit: 0 = Sunday … 6 = Saturday; default = weekday of the due date. */
  weekdays?: number[];
  /** Total instances, then stop. */
  count?: number;
  /** Last possible due time (inclusive), epoch ms. */
  until?: number;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** A repeat series anchored at a due time: occurrences fall on that time of day. */
export function todoRepeat(rule: RepeatRule, dueAt: number): TodoRepeat {
  const d = parts(dueAt);
  return {
    type: 'every',
    unit: rule.unit,
    interval: Math.max(1, Math.round(rule.interval)),
    times: [`${pad(d.hour)}:${pad(d.minute)}`],
    weekdays: rule.unit === 'week' ? (rule.weekdays?.length ? [...new Set(rule.weekdays)].sort() : [d.weekday % 7]) : undefined,
    startAt: startOfDay(dueAt),
    count: rule.count,
    until: rule.until,
  };
}

export function repeatRuleOf(r: TodoRepeat): RepeatRule {
  return {
    unit: r.unit === 'week' ? 'week' : 'day',
    interval: r.interval,
    weekdays: r.unit === 'week' ? r.weekdays : undefined,
    count: r.count,
    until: r.until,
  };
}

/**
 * First due time of a new repeating to-do that has none: the first occurrence from `now`, at
 * `time` ("HH:mm", default 09:00) on a matching day.
 */
export function firstDue(rule: RepeatRule, now: number, time = '09:00'): number | null {
  const n = parts(now);
  const [h, m] = time.split(':').map(Number);
  const anchor = at(n.year, n.month, n.day, h, m);
  const series = todoRepeat({ ...rule, weekdays: rule.unit === 'week' ? (rule.weekdays?.length ? rule.weekdays : [n.weekday % 7]) : undefined }, anchor);
  return nextOccurrence(series, now - 1)?.at ?? null;
}

/**
 * The next instance of a repeating to-do completed at `now`, or null when it doesn't repeat or
 * the series is over. Due: the first occurrence after the current due time, and never in the
 * past (completing a to-do late doesn't create one that is already overdue). The reminder
 * keeps its lead time when it was a one-shot relative to the due time; a reminder that would
 * fall before `now` is dropped.
 */
export function nextTodoInstance(
  todo: Pick<Todo, 'dueAt' | 'repeat'>,
  reminder: Trigger | null | undefined,
  now: number,
): { dueAt: number; remind: Trigger | null } | null {
  if (!todo.repeat) return null;
  const after = Math.max(todo.dueAt ?? now, now);
  const next = nextOccurrence(todo.repeat, after);
  if (!next) return null;
  let remind: Trigger | null = null;
  if (reminder?.type === 'at' && todo.dueAt != null) {
    const at = next.at - (todo.dueAt - reminder.at);
    if (at > now) remind = { type: 'at', at };
  }
  return { dueAt: next.at, remind };
}

export type TodoGroup = 'overdue' | 'today' | 'upcoming' | 'undated' | 'done';

const endOfDay = (now: number) => {
  const d = parts(now);
  return at(d.year, d.month, d.day + 1);
};

/** Which list a to-do belongs in at `now`. */
export function todoGroup(t: Pick<Todo, 'dueAt' | 'doneAt'>, now: number): TodoGroup {
  if (t.doneAt) return 'done';
  if (t.dueAt == null) return 'undated';
  if (t.dueAt < now) return 'overdue';
  return t.dueAt < endOfDay(now) ? 'today' : 'upcoming';
}

const high = (t: Pick<Todo, 'priority'>) => (t.priority === 'high' ? 0 : 1);

/** Order within a group: by due time (high priority first on ties), undated by priority then age, done newest first. */
export function compareTodos(a: Todo, b: Todo): number {
  if (a.doneAt || b.doneAt) return (b.doneAt ?? 0) - (a.doneAt ?? 0);
  if (a.dueAt != null && b.dueAt != null) return a.dueAt - b.dueAt || high(a) - high(b);
  return high(a) - high(b) || a.createdAt - b.createdAt;
}

/** To-dos by group, each sorted; every group is present (possibly empty). */
export function groupTodos(todos: Todo[], now: number): Record<TodoGroup, Todo[]> {
  const out: Record<TodoGroup, Todo[]> = { overdue: [], today: [], upcoming: [], undated: [], done: [] };
  for (const t of todos) out[todoGroup(t, now)].push(t);
  for (const list of Object.values(out)) list.sort(compareTodos);
  return out;
}

export type TodoView = 'today' | 'upcoming' | 'all';

/**
 * Open to-dos for a view: 'today' = overdue + due today + undated high priority;
 * 'upcoming' = due after today; 'all' = every open one (overdue, today, upcoming, undated).
 */
export function todosForView(todos: Todo[], view: TodoView, now: number): Todo[] {
  const g = groupTodos(todos, now);
  if (view === 'today') return [...g.overdue, ...g.today, ...g.undated.filter((t) => t.priority === 'high')];
  if (view === 'upcoming') return g.upcoming;
  return [...g.overdue, ...g.today, ...g.upcoming, ...g.undated];
}
