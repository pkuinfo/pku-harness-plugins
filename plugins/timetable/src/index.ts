import { classesOn, classStatus, definePlugin, defineTool, formatWeeks, parseWeeks, timeOfDay, weekOf, type Course } from '@pku-harness/sdk';
import { z } from 'zod';

import { NextClassWidget } from './widget';

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const view = (c: Course) => ({
  id: c.id,
  name: c.name,
  weekday: WEEKDAY[c.weekday],
  time: `${c.start}-${c.end}`,
  location: c.location,
  teacher: c.teacher,
  weeks: formatWeeks(c.weeks),
});

const courseFields = {
  name: z.string().min(1),
  weekday: z.number().int().min(0).max(6).describe('0=Sunday … 6=Saturday'),
  start: timeOfDay,
  end: timeOfDay,
  location: z.string().optional(),
  teacher: z.string().optional(),
  weeks: z.string().optional().describe('teaching weeks, e.g. "1-16", "1-15单", "2-16双", "1,3,5"; default every week'),
};

/**
 * Class timetable. Courses are added by hand, by the agent, or synced from PKU by the
 * course-sync plugin (source "campus").
 */
export const timetablePlugin = definePlugin({
  id: 'timetable',
  name: '课表',
  description: '课程表、今天的课和上课提醒。',
  version: '0.3.0',
  icon: 'book',
  core: true,
  scopes: [],
  contributes: {
    widgets: {
      next: { title: '下一节课', description: '正在上或接下来的一节课，含地点、倒计时和进度，随时间自动更新。', sizes: ['sm', 'md'], defaultSize: 'md', component: NextClassWidget },
    },
  },
  instructions: '课表用 timetable 工具。用户口述课程时，逐门调用 timetable__addCourse（时间用 HH:MM，星期 0=周日）。上课提醒用 timetable__setReminder 设置提前分钟数。用户想从学校导入课表时用 course-sync 插件。',
  dataSources: {
    today: { title: '今天的课', tool: 'today', ttlMs: 60_000 },
  },
  tools: {
    list: defineTool({
      title: '查看课表',
      description: 'All courses in the timetable.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => ctx.services.timetable.get().courses.map(view),
    }),
    today: defineTool({
      title: '今天的课',
      description: 'Classes on a day (default today) with status, and the next class.',
      input: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
      effect: 'read',
      execute: async ({ date }, ctx) => {
        const now = new Date();
        const day = date ? new Date(`${date}T00:00:00`) : now;
        const { courses, semester } = ctx.services.timetable.get();
        const list = classesOn(courses, day, semester).map((c) => ({ ...view(c), ...(date ? {} : classStatus(c, now)) }));
        const next = date ? null : (list.find((c) => 'state' in c && c.state !== 'after') ?? null);
        return { week: weekOf(semester, day), count: list.length, classes: list, next };
      },
    }),
    addCourse: defineTool({
      title: '添加课程',
      description: 'Add one weekly class meeting to the timetable.',
      input: z.object(courseFields),
      effect: 'write',
      execute: async (input, ctx) => {
        const timetable = ctx.services.timetable;
        const c: Course = {
          id: timetable.newId(),
          name: input.name,
          weekday: input.weekday,
          start: input.start,
          end: input.end,
          location: input.location ?? null,
          teacher: input.teacher ?? null,
          weeks: input.weeks ? parseWeeks(input.weeks, timetable.get().semester?.weeks) : null,
          color: timetable.get().courses.length % 8,
          source: 'manual',
        };
        await timetable.upsert(c);
        return view(c);
      },
    }),
    updateCourse: defineTool({
      title: '修改课程',
      description: 'Change a course; only pass what changes.',
      input: z.object({ id: z.string(), ...z.object(courseFields).partial().shape }),
      effect: 'write',
      execute: async ({ id, weeks, location, teacher, ...rest }, ctx) => {
        const timetable = ctx.services.timetable;
        const cur = timetable.get().courses.find((c) => c.id === id);
        if (!cur) throw new Error(`没有这门课：${id}`);
        const c: Course = {
          ...cur,
          ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
          location: location === undefined ? cur.location : location || null,
          teacher: teacher === undefined ? cur.teacher : teacher || null,
          weeks: weeks === undefined ? cur.weeks : weeks ? parseWeeks(weeks, timetable.get().semester?.weeks) : null,
        };
        await timetable.upsert(c);
        return view(c);
      },
    }),
    removeCourse: defineTool({
      title: '删除课程',
      description: 'Remove a course (and its class reminders).',
      input: z.object({ id: z.string() }),
      effect: 'write',
      execute: async ({ id }, ctx) => {
        const c = ctx.services.timetable.get().courses.find((x) => x.id === id);
        if (!c) throw new Error(`没有这门课：${id}`);
        await ctx.services.timetable.remove(id);
        return { removed: c.name };
      },
    }),
    setReminder: defineTool({
      title: '设置上课提醒',
      description: 'Remind before every class: minutes before start, or null to turn off.',
      input: z.object({ minutesBefore: z.number().int().min(0).max(180).nullable() }),
      effect: 'write',
      execute: async ({ minutesBefore }, ctx) => {
        await ctx.services.timetable.setReminderMinutes(minutesBefore);
        return { minutesBefore, courses: ctx.services.timetable.get().courses.length };
      },
    }),
  },
});
