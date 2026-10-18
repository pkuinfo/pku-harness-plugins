import type { Trigger } from './scheduler/types';

export type Todo = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: number | null;
  doneAt: number | null;
  /** Reminder job in the scheduler, if any. */
  jobId: string | null;
  createdAt: number;
};

export type TodoInput = {
  title: string;
  notes?: string | null;
  dueAt?: number | null;
  /** When to remind; null = no reminder. A trigger allows repeating reminders. */
  remind?: Trigger | null;
};
