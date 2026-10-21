import { describe, expect, test } from 'bun:test';

import { agentJobHeader, isSilentReply, ALERT_COOLDOWN_MS, checkScheduleProblem, DISABLE_AFTER, HISTORY_LIMIT, isLate, minGap, recordRun } from './policy';
import type { Job, JobRun } from './types';

const T0 = new Date(2026, 9, 21, 8, 0).getTime();
const job = (over: Partial<Job> = {}): Job => ({
  id: 'j', title: 'x', trigger: { type: 'at', at: T0 }, action: { type: 'notify', title: 'x' }, enabled: true, source: 'agent',
  runs: 0, lastRunAt: null, nextRunAt: null, createdAt: T0, updatedAt: T0, ...over,
});
const run = (at: number, ok: boolean): JobRun => ({ at, scheduledAt: at, ok, notified: false, ms: 10, ...(ok ? {} : { error: 'boom' }) });

describe('schedule limits', () => {
  test('a check may not repeat more often than every 15 minutes', () => {
    expect(checkScheduleProblem({ type: 'every', unit: 'minute', interval: 5, startAt: T0 }, T0 - 1)).toContain('15');
    expect(checkScheduleProblem({ type: 'every', unit: 'minute', interval: 15, startAt: T0 }, T0 - 1)).toBeNull();
    expect(checkScheduleProblem({ type: 'every', unit: 'day', interval: 1, times: ['08:00', '08:10'], startAt: T0 }, T0 - 1)).toContain('15');
    expect(checkScheduleProblem({ type: 'every', unit: 'day', interval: 1, times: ['08:00'], startAt: T0 }, T0 - 1)).toBeNull();
    expect(minGap({ type: 'at', at: T0 }, T0 - 1)).toBe(Infinity);
  });
});

describe('recordRun', () => {
  test('success resets failures and logs newest first, capped', () => {
    let j = job({ failures: 3, history: Array.from({ length: HISTORY_LIMIT }, (_, i) => run(T0 - i * 1000, true)) });
    const r = recordRun(j, run(T0 + 1, true));
    expect(r.alert).toBe('none');
    expect(r.patch.failures).toBe(0);
    expect(r.patch.history).toHaveLength(HISTORY_LIMIT);
    expect(r.patch.history![0].at).toBe(T0 + 1);
    j = { ...j, ...r.patch };
    expect(j.enabled).toBe(true);
  });

  test('alerts once after 2 failures, again only after the cooldown, disables after 10', () => {
    let j = job();
    const alerts: string[] = [];
    for (let i = 0; i < DISABLE_AFTER; i++) {
      const at = T0 + i * 60 * 60_000; // hourly
      const r = recordRun(j, run(at, false));
      alerts.push(r.alert);
      j = { ...j, ...r.patch };
    }
    // 2nd failure alerts; the next alert waits 6 h (hourly runs → the 8th); the 10th disables.
    expect(alerts).toEqual(['none', 'failing', 'none', 'none', 'none', 'none', 'none', 'failing', 'none', 'disabled']);
    expect(j.enabled).toBe(false);
    expect(ALERT_COOLDOWN_MS).toBe(6 * 3_600_000);
  });

  test('late runs are flagged', () => {
    expect(isLate({ at: T0 + 6 * 60_000, scheduledAt: T0 })).toBe(true);
    expect(isLate({ at: T0 + 60_000, scheduledAt: T0 })).toBe(false);
    expect(isLate({ at: T0, scheduledAt: null })).toBe(false);
  });
});

describe('agent runs', () => {
  test('NO_REPLY or nothing stays silent; a real answer notifies', () => {
    expect(isSilentReply('NO_REPLY')).toBe(true);
    expect(isSilentReply('  no_reply.')).toBe(true);
    expect(isSilentReply('')).toBe(true);
    expect(isSilentReply('树洞热帖：……')).toBe(false);
  });
  test('the job header is identical across runs (cache prefix) and escapes the prompt', () => {
    const job = { id: 'j1', title: '树洞早报', prompt: '总结"热帖"\n三条' };
    expect(agentJobHeader(job)).toBe(agentJobHeader({ ...job }));
    expect(agentJobHeader(job).split('\n')).toHaveLength(3);
  });
});

