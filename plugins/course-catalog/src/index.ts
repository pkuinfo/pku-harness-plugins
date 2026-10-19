import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

import { deanOptions, deanSearch, ELECTIVE_CATEGORIES, electiveSearch } from './api';
import { semesterCode, type CatalogCourse } from './parse';

/** 1 = Monday … 7 = Sunday (what the model and users say) → JS weekday. */
const jsWeekday = (d: number) => d % 7;

const byWeekday = (courses: CatalogCourse[], weekday?: number) =>
  weekday == null ? courses : courses.filter((c) => c.sessions.some((s) => s.weekday === jsWeekday(weekday)));

/** Fewer tokens: drop empty fields. */
const compact = (c: CatalogCourse) =>
  Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== 'source' && v !== '' && !(Array.isArray(v) && !v.length)));

/**
 * 全校课程目录 (pkucli crates/claspider): the dean's public course search (dean.pku.edu.cn,
 * no login) and the elective system's course query (elective.pku.edu.cn, signed in, has rooms).
 * Read-only: electing and dropping courses are not here.
 */
export const courseCatalogPlugin = definePlugin({
  id: 'course-catalog',
  name: '全校课程目录',
  description: '按课程名、教师、院系搜索全校开课，含上课时间（选课网查询含教室）。只读。',
  version: '0.1.0',
  icon: 'book',
  requires: ['network'],
  scopes: ['dean.pku.edu.cn', 'elective.pku.edu.cn'],
  instructions: `全校课程目录（只读，不能选课/退课）：
- course-catalog__search：教务部课表查询（公开，无需登录），按课程名/教师/院系搜某学期的开课，返回课号、班号、学分、教师、开课单位、上课时间（星期、节次和时间）、起止周。没有教室。
- 需要教室地点时用 course-catalog__searchElective（选课网，需要已登录校园账号，按课程分类查，较慢）。
- 院系可以直接写名称（如"信息科学技术学院"），不确定时先用 course-catalog__departments 查代码。
- 学期代码形如 "25-26-1"（25-26 学年第 1 学期），默认当前学期。
- 用户想把某门课加进课表时，用 timetable__addCourse，按 sessions 里的 weekday、start、end、room 和 weeks（单双周看 weekType）逐个添加。`,
  tools: {
    search: defineTool({
      title: '搜索全校课程',
      description:
        'Search the PKU course catalog (教务部课表查询, public, no login) by course name keyword, teacher and/or department. Returns course id, class no., credit, teacher, department, category, weeks and sessions (weekday 0=Sun..6=Sat, periods, start/end time). No classroom here: use searchElective for rooms. Give at least one of name / teacher / department.',
      input: z.object({
        name: z.string().optional().describe('course name keyword, e.g. "高等数学"'),
        teacher: z.string().optional().describe("teacher's name"),
        department: z.string().optional().describe('department name (e.g. "信息科学技术学院") or code (e.g. "00048")'),
        semester: z.string().regex(/^\d{2}-\d{2}-[123]$/).optional().describe('e.g. "25-26-1"; default the current semester'),
        weekday: z.number().int().min(1).max(7).optional().describe('only courses meeting on this day, 1 = Monday … 7 = Sunday'),
        limit: z.number().int().min(1).max(100).optional().describe('max results, default 30'),
      }),
      effect: 'read',
      execute: async ({ name, teacher, department, semester, weekday, limit }, ctx) => {
        if (!name?.trim() && !teacher?.trim() && !department?.trim()) throw new Error('请至少给出课程名、教师或院系中的一个');
        const sem = semester ?? semesterCode(new Date());
        let code: string | undefined;
        let deptFilter: string | undefined;
        let deptNote: string | undefined;
        if (department?.trim()) {
          const d = department.trim();
          if (/^\d+$/.test(d)) code = d;
          else {
            const { departments } = await deanOptions(ctx.kv, ctx.signal).catch(() => ({ departments: [] as { value: string; label: string }[] }));
            const hits = departments.filter((o) => o.label === d || o.label.includes(d) || d.includes(o.label));
            const exact = hits.find((o) => o.label === d) ?? hits[0];
            if (exact) {
              code = exact.value;
              if (hits.length > 1 && exact.label !== d) deptNote = `院系"${d}"匹配到多个，已使用"${exact.label}"：${hits.map((h) => h.label).join('、')}`;
            } else if (name?.trim() || teacher?.trim()) {
              // Unknown name: filter locally on 开课单位 instead.
              deptFilter = d;
            } else {
              throw new Error(`没有找到院系"${d}"，可以先用 course-catalog__departments 查看院系列表`);
            }
          }
        }
        const max = limit ?? 30;
        // Local filters need a wider fetch to still return `max` matches.
        const fetchLimit = weekday != null || deptFilter ? Math.min(100, max * 3) : max;
        const { total, courses } = await deanSearch({ semester: sem, name: name?.trim(), teacher: teacher?.trim(), department: code }, fetchLimit, ctx.signal);
        let list = byWeekday(courses, weekday);
        if (deptFilter) list = list.filter((c) => c.department.includes(deptFilter!));
        list = list.slice(0, max);
        return {
          semester: sem,
          total,
          returned: list.length,
          truncated: total > courses.length,
          ...(deptNote ? { note: deptNote } : {}),
          courses: list.map(compact),
        };
      },
    }),
    departments: defineTool({
      title: '院系与学期列表',
      description: 'Department codes and semester codes accepted by course-catalog search (from the dean search form). Optional name filter.',
      input: z.object({ query: z.string().optional().describe('filter departments by name') }),
      effect: 'read',
      execute: async ({ query }, ctx) => {
        const { departments, semesters } = await deanOptions(ctx.kv, ctx.signal);
        if (!departments.length) throw new Error('教务部页面里没找到院系列表，网站可能已改版');
        const q = query?.trim();
        return {
          departments: (q ? departments.filter((d) => d.label.includes(q)) : departments).map((d) => ({ code: d.value, name: d.label })),
          semesters: semesters.map((s) => ({ code: s.value, name: s.label })),
          current: semesterCode(new Date()),
        };
      },
    }),
    searchElective: defineTool({
      title: '选课网查课（含教室）',
      description:
        'Query the elective system\'s course list (选课网「添加其它课程」, needs the signed-in campus account) by category, optionally a department code and a name keyword. Unlike search it includes classrooms per session. Categories: speciality 专业课, politics 政治, english 英语, gym 体育, tsk_choice 通识, pub_choice 公选, liberal_computer 计算机基础, ldjyk 劳动教育, szxzxbx 思政选择性必修, education_plan_bk 培养方案. Slow (100 rows per page); only works while the elective system is open.',
      input: z.object({
        category: z.enum(ELECTIVE_CATEGORIES).describe('course category'),
        name: z.string().optional().describe('course name keyword (filtered locally)'),
        department: z.string().regex(/^\d*$/).optional().describe('department code, e.g. "00048" (see departments)'),
        weekday: z.number().int().min(1).max(7).optional().describe('1 = Monday … 7 = Sunday'),
        maxPages: z.number().int().min(1).max(10).optional().describe('pages of 100 to read, default 3'),
        limit: z.number().int().min(1).max(100).optional().describe('max results, default 30'),
      }),
      effect: 'read',
      execute: async ({ category, name, department, weekday, maxPages, limit }, ctx) => {
        const res = await electiveSearch(ctx.services, { category, name: name?.trim() || undefined, department, maxPages: maxPages ?? 3 });
        const list = byWeekday(res.courses, weekday);
        const max = limit ?? 30;
        return {
          matched: list.length,
          returned: Math.min(max, list.length),
          pagesRead: res.pagesRead,
          totalPages: res.totalPages,
          truncated: res.pagesRead < res.totalPages || list.length > max,
          courses: list.slice(0, max).map(compact),
        };
      },
    }),
  },
});
