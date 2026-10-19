import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

import { results, search, supplementPage, supplyCancel } from './api';

const program = z.enum(['major', 'minor']).optional().describe('dual-degree accounts only: major = 主修 (default), minor = 辅双/双学位; ignored otherwise');

/**
 * 选课网 elective.pku.edu.cn (pkucli crates/elective), read-only. Electing and dropping need a
 * CAPTCHA and can't be undone, so they stay on the official site.
 */
export const electivePlugin = definePlugin({
  id: 'elective',
  name: '选课网',
  description: '选课网选课结果、补退选课程余量和课程搜索（只读，选课请到官网）。',
  version: '0.1.0',
  icon: 'todo',
  requires: ['campus-session', 'network'],
  scopes: ['elective.pku.edu.cn'],
  instructions: `选课网（elective.pku.edu.cn）只读：elective__results 选课结果（已选上 / 未选上 / 待抽签），elective__supplements 补退选课程列表和余量（按页，含已选课程），elective__search 按课程名 / 教师 / 课程号搜索补退选课程。
- 只能查，不能选课、退课：这两步要验证码且不可撤销。用户想选或退时，告诉他到官网 https://elective.pku.edu.cn 自己操作；可以先帮他查余量、班号，或用 scheduler 建提醒（例如补退选开放时）。
- 选课网只在选课阶段开放；返回"不在选课阶段"之类提示时如实转告。
- 双学位学生每次只能看一个项目：program=major 主修（默认），minor 辅双；结果里的 program 字段说明看到的是哪个。
- 问"这学期课表 / 什么时候上课"不要用这里（用 timetable / course-sync），这里只看一个项目且不含完整时间表。
- remaining = 限数 − 已选；full=true 表示已满（有候补时 waitlist 是候补人数）。`,
  tools: {
    results: defineTool({
      title: '选课结果',
      description: 'My election results this term (showResults): each course with class number, teacher, classroom/time info and result (e.g. 已选上, 未选上, 待抽签).',
      input: z.object({ program }),
      effect: 'read',
      execute: async ({ program }, ctx) => results(ctx.services, program),
    }),
    supplements: defineTool({
      title: '补退选课程',
      description:
        'One page (20 courses) of the supplementary election (补退选) list with quota, elected count and remaining seats, plus totalPages and the courses I already elected. Only works during the election period. Read-only: never elects.',
      input: z.object({
        page: z.number().int().min(1).optional().describe('1-based page, default 1'),
        onlyAvailable: z.boolean().optional().describe('drop full courses'),
        program,
      }),
      effect: 'read',
      execute: async ({ page = 1, onlyAvailable, program }, ctx) => {
        const entry = await supplyCancel(ctx.services, program);
        if (page > entry.totalPages) throw new Error(`页码 ${page} 超出范围（共 ${entry.totalPages} 页）`);
        const courses = await supplementPage(ctx.services, page - 1, program);
        return { ...entry, page, courses: onlyAvailable ? courses.filter((c) => c.full !== true) : courses };
      },
    }),
    search: defineTool({
      title: '搜索补退选课程',
      description:
        'Search the 补退选 list by course name, teacher, course code or department (substring, case-insensitive). Walks the list page by page (up to 25 pages), so it takes a few seconds; truncated=true means later pages were not searched.',
      input: z.object({
        query: z.string().min(1).describe('e.g. "数据结构", a teacher name, or a course code'),
        onlyAvailable: z.boolean().optional().describe('only courses with seats left'),
        program,
      }),
      effect: 'read',
      execute: async ({ query, onlyAvailable, program }, ctx) => search(ctx.services, query, { onlyAvailable, program }),
    }),
  },
});
