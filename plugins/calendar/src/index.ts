import { definePlugin, defineTool, formatLocal } from '@pku-harness/sdk';
import { z } from 'zod';

import { fetchCalendar } from './api';
import { currentSemester, semesters, type SemesterInfo } from './parse';

type Semester = { name: string; start: string; weeks: number };

const DAY = 86_400_000;
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Week number (1-based) of `now` in a semester whose week 1 starts on the Monday of `start`. */
export function semesterWeek(sem: Semester, now: Date) {
  const [y, m, d] = sem.start.split('-').map(Number);
  const s = new Date(y, m - 1, d);
  const monday = new Date(y, m - 1, d - ((s.getDay() + 6) % 7));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - monday.getTime()) / DAY);
  const week = Math.floor(days / 7) + 1;
  return { week, inSemester: week >= 1 && week <= sem.weeks, daysLeft: Math.max(0, sem.weeks * 7 - days - 1) };
}

const today = () => formatLocal(Date.now()).slice(0, 10);

/** Pick a semester from the official calendar: explicit year/semester, else the current one. */
function pick(list: SemesterInfo[], year?: string, semester?: 'first' | 'second') {
  if (year || semester) {
    return list.find((s) => (!year || s.year.includes(year)) && (!semester || s.semester === semester)) ?? null;
  }
  return currentSemester(list, today());
}

const brief = (s: SemesterInfo, withLines: boolean) => ({
  name: s.name,
  year: s.year,
  semester: s.semester,
  start: s.start,
  weeks: s.weeks,
  weeksFrom: s.weeksFrom,
  holidays: s.holidays,
  exams: s.exams,
  events: s.events,
  ...(withLines ? { lines: s.lines } : {}),
});

/**
 * Today and the academic calendar. Semester dates come from the official 校历
 * (simso.pku.edu.cn, pkucli crates/portal/src/calendar.rs) or from the user, never guessed.
 */
export const calendarPlugin = definePlugin({
  id: 'calendar',
  name: '日期与校历',
  description: '今天的日期、星期、第几教学周，以及北大官方校历（开学、节假日、考试周），可一键设置课表学期。',
  version: '0.3.0',
  icon: 'schedule',
  core: true,
  scopes: ['simso.pku.edu.cn'],
  instructions: `日期与校历：
- calendar__today：今天的日期、星期、第几教学周。学期未设置时 semester 为 null。
- calendar__officialCalendar：北大官方校历（simso.pku.edu.cn，公开数据，无需登录）：开学日期、教学周数、节假日调休、考试周。问到放假、考试周、哪天开学时用它；lines 是校历原文，解析出的日期是尽力而为，有疑问以原文为准。
- 学期未设置或用户要同步校历时，用 calendar__syncSemester 从官方校历设置课表学期；解析不出开学日期或周数时，把原文告诉用户，确认后用 calendar__setSemester 手动保存。不要凭记忆猜校历。`,
  dataSources: {
    today: { title: '今天 / 教学周', tool: 'today', ttlMs: 30 * 60_000 },
  },
  tools: {
    today: defineTool({
      title: '今天',
      description: 'Today\'s date, weekday and the current teaching week of the semester (if configured).',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => {
        const now = new Date();
        const sem = await ctx.kv.get<Semester>('semester');
        const w = sem ? semesterWeek(sem, now) : null;
        return {
          date: formatLocal(now.getTime()).slice(0, 10),
          month: now.getMonth() + 1,
          day: now.getDate(),
          weekday: WEEKDAY[now.getDay()],
          semester: sem && w ? { name: sem.name, week: w.week, totalWeeks: sem.weeks, inSemester: w.inSemester, daysLeft: w.daysLeft } : null,
        };
      },
    }),
    setSemester: defineTool({
      title: '设置学期',
      description: 'Save the current semester: first day of week 1 and the number of teaching weeks.',
      input: z.object({
        name: z.string().describe('e.g. "2026 秋季学期"'),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('first day of week 1, YYYY-MM-DD'),
        weeks: z.number().int().min(1).max(30),
      }),
      effect: 'write',
      execute: async (input, ctx) => {
        await ctx.kv.set('semester', input);
        await ctx.services.timetable.reloadSemester();
        return { saved: input, ...semesterWeek(input, new Date()) };
      },
    }),
    officialCalendar: defineTool({
      title: '官方校历',
      description:
        "PKU's official school calendar (校历, public, no login): per semester the first day of teaching week 1, number of weeks, holidays / make-up days and exam weeks, plus the calendar's original lines. Defaults to the current or upcoming semester; pass year (e.g. \"2025-2026\") and/or semester, or all=true for every semester published. Dates other than the raw lines are parsed best-effort.",
      input: z.object({
        year: z.string().optional().describe('academic year, e.g. "2025-2026" or "2025"'),
        semester: z.enum(['first', 'second']).optional().describe('first = 秋季/第一学期, second = 春季/第二学期'),
        all: z.boolean().optional().describe('every semester on the calendar (without the raw lines)'),
        refresh: z.boolean().optional().describe('ignore the one-day cache'),
      }),
      effect: 'read',
      execute: async ({ year, semester, all, refresh }, ctx) => {
        const list = semesters(await fetchCalendar(ctx.kv, { force: refresh, signal: ctx.signal }));
        if (all) return { today: today(), semesters: list.map((s) => brief(s, false)) };
        const s = pick(list, year, semester);
        if (!s) {
          return { today: today(), found: false, available: list.map((x) => ({ year: x.year, semester: x.semester, start: x.start })) };
        }
        return { today: today(), found: true, ...brief(s, true) };
      },
    }),
    syncSemester: defineTool({
      title: '按校历设置学期',
      description:
        'Set the timetable semester (teaching weeks, odd/even weeks, class reminders) from the official calendar: start = first day of week 1, weeks = teaching + exam weeks. Defaults to the current or upcoming semester. If the calendar does not state the number of weeks, pass `weeks` (ask the user). Returns needs_input when start or weeks could not be read.',
      input: z.object({
        year: z.string().optional().describe('academic year, e.g. "2025-2026"'),
        semester: z.enum(['first', 'second']).optional(),
        weeks: z.number().int().min(1).max(30).optional().describe('override the number of teaching weeks'),
      }),
      effect: 'write',
      execute: async ({ year, semester, weeks }, ctx) => {
        const list = semesters(await fetchCalendar(ctx.kv, { signal: ctx.signal }));
        const s = pick(list, year, semester);
        if (!s) throw new Error('官方校历里没有找到这个学期');
        const total = weeks ?? s.weeks;
        if (!s.start || !total) {
          return {
            status: 'needs_input',
            missing: [...(s.start ? [] : ['start']), ...(total ? [] : ['weeks'])],
            hint: '校历里没能读出开学日期或教学周数。请根据原文和用户确认后调用 calendar__setSemester。',
            name: s.name,
            start: s.start,
            lines: s.lines,
          };
        }
        const sem: Semester = { name: s.name, start: s.start, weeks: total };
        await ctx.kv.set('semester', sem);
        await ctx.services.timetable.reloadSemester();
        return { status: 'saved', saved: sem, weeksFrom: weeks ? 'input' : s.weeksFrom, ...semesterWeek(sem, new Date()), holidays: s.holidays, exams: s.exams };
      },
    }),
  },
});
