/**
 * Assignment deadlines → to-dos with reminders. Pure planning so re-syncs are idempotent and
 * testable: the plugin keeps `key → todoId` (key = courseId:contentId) in its store and applies
 * the plan with `services.todos`.
 */

export type SyncAssignment = { course: string; courseId: string; contentId: string; title: string; deadline: number | null; submitted: boolean };
export type ExistingTodo = { title: string; dueAt: number | null; doneAt: number | null };

export type SyncStep =
  | { kind: 'add'; key: string; title: string; notes: string; dueAt: number; remindAt: number | null }
  | { kind: 'update'; key: string; todoId: string; title: string; notes: string; dueAt: number; remindAt: number | null }
  | { kind: 'done'; key: string; todoId: string }
  | { kind: 'keep'; key: string; todoId: string };

export const syncKey = (a: Pick<SyncAssignment, 'courseId' | 'contentId'>) => `${a.courseId}:${a.contentId}`;

/** Remind `hours` before the deadline; if that already passed, an hour before; else no reminder. */
export function remindTime(deadline: number, hours: number, now: number): number | null {
  const first = deadline - hours * 3600_000;
  if (first > now + 60_000) return first;
  const late = deadline - 3600_000;
  return late > now + 60_000 ? late : null;
}

/**
 * - unsubmitted, upcoming, never synced → add
 * - already synced, todo still there: deadline/title changed → update; submitted → done; else keep
 * - synced but the user deleted the todo (map value null or todo gone) → leave it alone
 * - submitted or past and never synced → nothing
 */
export function planSync(
  assignments: SyncAssignment[],
  synced: Record<string, string | null>,
  getTodo: (id: string) => ExistingTodo | undefined,
  opts: { now: number; remindHours: number },
): SyncStep[] {
  const steps: SyncStep[] = [];
  for (const a of assignments) {
    const key = syncKey(a);
    const title = `交作业：${a.title}`;
    const notes = `${a.course} · 教学网作业`;
    if (key in synced) {
      const id = synced[key];
      const todo = id ? getTodo(id) : undefined;
      if (!id || !todo) continue; // user removed it: respect that
      if (todo.doneAt != null) {
        steps.push({ kind: 'keep', key, todoId: id });
      } else if (a.submitted) {
        steps.push({ kind: 'done', key, todoId: id });
      } else if (a.deadline != null && (todo.dueAt !== a.deadline || todo.title !== title)) {
        steps.push({ kind: 'update', key, todoId: id, title, notes, dueAt: a.deadline, remindAt: remindTime(a.deadline, opts.remindHours, opts.now) });
      } else {
        steps.push({ kind: 'keep', key, todoId: id });
      }
      continue;
    }
    if (a.submitted || a.deadline == null || a.deadline <= opts.now) continue;
    steps.push({ kind: 'add', key, title, notes, dueAt: a.deadline, remindAt: remindTime(a.deadline, opts.remindHours, opts.now) });
  }
  return steps;
}
