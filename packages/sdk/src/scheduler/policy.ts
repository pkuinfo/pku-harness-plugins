/**
 * Unattended-run policy for scheduled checks (docs/ARCHITECTURE.md §8). A check runs with no one
 * watching, so it is limited, logged and loud about failures, not silent:
 *
 * - **Limits**: at most MAX_ACTIVE_JOBS enabled jobs; a check repeats at most every
 *   MIN_CHECK_GAP_MS (campus services are shared; a balance doesn't change by the minute).
 * - **Run log**: the last HISTORY_LIMIT runs (scheduled vs actual time, result, error).
 * - **Failures**: after FAIL_ALERT_AFTER consecutive failures the user is told once (again only
 *   after ALERT_COOLDOWN_MS); after DISABLE_AFTER the job turns itself off and says so.
 *   (After OpenClaw's cron failure alerts and auto-disable.)
 *
 * Pure: no React Native imports, unit-tested.
 */
import { occurrencesAfter } from './recurrence';
import type { Job, JobRun, Trigger } from './types';

export const MAX_ACTIVE_JOBS = 50;
export const MIN_CHECK_GAP_MS = 15 * 60_000;
/** Agent runs cost model calls: at most every hour, at most MAX_AGENT_JOBS, AGENT_MAX_STEPS steps each (a list + three reads + the answer fits). */
export const MIN_AGENT_GAP_MS = 60 * 60_000;
export const MAX_AGENT_JOBS = 10;
export const AGENT_MAX_STEPS = 8;
export const HISTORY_LIMIT = 20;
export const FAIL_ALERT_AFTER = 2;
export const DISABLE_AFTER = 10;
export const ALERT_COOLDOWN_MS = 6 * 3_600_000;
/** A recurring check due longer ago than this is logged as missed rather than run (an 8:00 check at 15:00 helps no one). */
export const MAX_LATE_MS = 2 * 3_600_000;
/** A run this much later than scheduled is marked late in the log (Doze, a killed app). */
export const LATE_MS = 5 * 60_000;

/** Smallest gap between the next occurrences of a trigger (Infinity for one-shots). */
export function minGap(trigger: Trigger, now: number): number {
  const next = occurrencesAfter(trigger, now, 12).map((o) => o.at);
  let gap = Infinity;
  for (let i = 1; i < next.length; i++) gap = Math.min(gap, next[i] - next[i - 1]);
  return gap;
}

/** Why a check schedule is not allowed, or null. */
export function checkScheduleProblem(trigger: Trigger, now: number): string | null {
  const gap = minGap(trigger, now);
  return gap < MIN_CHECK_GAP_MS ? `定时检查最频繁每 ${MIN_CHECK_GAP_MS / 60_000} 分钟一次（这个安排约每 ${Math.max(1, Math.round(gap / 60_000))} 分钟一次）` : null;
}

export type RunAlert = 'none' | 'failing' | 'disabled';

/** The job's fields after a run, and whether to tell the user about failures. */
export function recordRun(job: Job, run: JobRun): { patch: Pick<Job, 'history' | 'failures' | 'alertedAt' | 'enabled'>; alert: RunAlert } {
  const history = [run, ...(job.history ?? [])].slice(0, HISTORY_LIMIT);
  if (run.ok) return { patch: { history, failures: 0, alertedAt: job.alertedAt ?? null, enabled: job.enabled }, alert: 'none' };
  const failures = (job.failures ?? 0) + 1;
  if (failures >= DISABLE_AFTER) return { patch: { history, failures, alertedAt: run.at, enabled: false }, alert: 'disabled' };
  const due = failures >= FAIL_ALERT_AFTER && (job.alertedAt == null || run.at - job.alertedAt >= ALERT_COOLDOWN_MS);
  return { patch: { history, failures, alertedAt: due ? run.at : (job.alertedAt ?? null), enabled: job.enabled }, alert: due ? 'failing' : 'none' };
}

/** Whether a run happened noticeably after its scheduled time. */
export const isLate = (run: Pick<JobRun, 'at' | 'scheduledAt'>) => run.scheduledAt != null && run.at - run.scheduledAt > LATE_MS;

/** The reply an unattended agent run gives when there is nothing worth telling the user. */
export const NO_REPLY = 'NO_REPLY';

/** Whether an agent run's reply means "stay silent" (no notification). */
export const isSilentReply = (text: string) => !text.trim() || text.trim().toUpperCase().startsWith(NO_REPLY);

/** First message of every run of an agent job: the same bytes each run, so runs share the cache. */
export function agentJobHeader(job: { id: string; title: string; prompt: string }): string {
  return `[定时任务]\n这是用户事先安排、现在自动运行的任务，用户此刻不在场，无法回答问题或确认操作。\n${JSON.stringify({ id: job.id, title: job.title, task: job.prompt })}`;
}

