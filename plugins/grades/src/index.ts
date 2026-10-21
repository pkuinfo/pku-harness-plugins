import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

import { fetchScores, sendCode, type Pending } from './api';
import { filterSemesters, parseScores } from './parse';
import { GpaWidget } from './widget';

const codeInput = {
  code: z.string().trim().min(4).max(8).optional().describe('SMS or 手机令牌 code when a previous call asked for one'),
  method: z.enum(['sms', 'otp']).optional().describe('how the code was obtained; default sms'),
};

/**
 * Scores and GPA via the treehole course API (pkucli crates/treehole/src/api.rs `get_scores`,
 * display.rs `print_scores`). Read-only. Shares treehole's course-data token with course-sync:
 * verifying in either unlocks both until the server expires it.
 */
export const gradesPlugin = definePlugin({
  id: 'grades',
  name: '成绩',
  description: '查询各学期成绩和绩点（GPA）。',
  version: '0.1.0',
  i18n: {
    en: {
      name: 'Grades',
      description: 'Your grades and GPA, semester by semester.',
      tools: { listScores: { title: 'Check grades' }, gpa: { title: 'Check GPA' }, sendCode: { title: 'Send verification code' } },
      widgets: { gpa: { title: 'Overall GPA', description: 'Your overall GPA and total credits; hidden until you tap, since grades are private.' } },
    },
  },
  icon: 'check',
  requires: ['campus-session', 'network'],
  scopes: ['treehole.pku.edu.cn（成绩）'],
  contributes: {
    widgets: {
      gpa: {
        title: '总绩点',
        description: '总 GPA 和总学分；默认遮住数字，点一下才显示（成绩属于隐私）。',
        sizes: ['sm', 'md'],
        defaultSize: 'sm',
        component: GpaWidget,
      },
    },
  },
  instructions: `成绩和绩点是隐私：只在用户明确问起时才调用 grades 的工具或提及具体分数，不要主动在其他回答、总结或看板建议里带出成绩。
- 问某学期/某门课的分数用 grades__listScores（可传 semester，如 "25-26-1" 或 "2025-2026-1"）；只问绩点用 grades__gpa。
- 已在「手机令牌」插件绑定时，成绩二次验证会自动完成，不必问用户。
- 返回 status "verification_required" 时：kind "login" 只能用短信；kind "course" 可用手机令牌（OTP）或短信。用 ui__render 给用户一个输入验证码的表单（发短信前先调用 grades__sendCode），拿到验证码后再调用原工具并传 code 和 method。
- GPA 以学校返回的为准（4 分制）；gpa 为 null 表示学校没给出，不要自己估算冒充官方数字。`,
  tools: {
    listScores: defineTool({
      title: '查询成绩',
      description:
        'The user\'s course scores grouped by semester (name, credits, score as written e.g. "92"/"A-"/"合格", category) with each semester\'s GPA. Sensitive: only when the user asks. May return verification_required; then call again with the code.',
      input: z.object({
        semester: z.string().trim().max(40).optional().describe('filter, e.g. "25-26-1" (one semester) or "25-26" (whole year); omit for all'),
        ...codeInput,
      }),
      effect: 'read',
      execute: async ({ semester, code, method = 'sms' }, ctx) => {
        const raw = await fetchScores(ctx, code, method);
        if ('status' in raw) return raw;
        const s = parseScores(raw);
        const semesters = filterSemesters(s.semesters, semester);
        return {
          status: 'ok',
          overallGpa: s.overallGpa,
          totalCredits: s.totalCredits,
          semesters: semesters.map((x) => ({ semester: x.id, label: x.label, gpa: x.gpa, credits: x.credits, courses: x.courses.map(({ semester: _s, ...c }) => c) })),
          ...(semester && !semesters.length ? { note: `没有找到学期 ${semester}；已有学期：${s.semesters.map((x) => x.id).join('、') || '无'}` } : {}),
        };
      },
    }),
    gpa: defineTool({
      title: '查询绩点',
      description: 'GPA summary: overall GPA and total credits, plus each semester\'s GPA, credits and course count. Sensitive: only when the user asks. May return verification_required; then call again with the code.',
      input: z.object(codeInput),
      effect: 'read',
      execute: async ({ code, method = 'sms' }, ctx) => {
        const raw = await fetchScores(ctx, code, method);
        if ('status' in raw) return raw;
        const s = parseScores(raw);
        return {
          status: 'ok',
          overallGpa: s.overallGpa,
          totalCredits: s.totalCredits,
          semesters: s.semesters.map((x) => ({ semester: x.id, label: x.label, gpa: x.gpa, credits: x.credits, courseCount: x.courses.length })),
        };
      },
    }),
    sendCode: defineTool({
      title: '发送验证码',
      description: 'Send the SMS code that the last grades call asked for (to the phone bound to the account).',
      input: z.object({}),
      effect: 'write',
      execute: async (_input, ctx) => {
        const pending = (await ctx.kv.get<Pending>('pending')) ?? 'course';
        return { sent: await sendCode(ctx, pending) };
      },
    }),
  },
});
