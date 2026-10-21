import { definePlugin, defineTool, type Course } from '@pku-harness/sdk';
import { z } from 'zod';

import { call, CODE_COURSE_TOKEN, CODE_SMS_CHECK, redeem, sendCode, type Pending } from './api';
import { parseCourseTable, periodTimes, type RawRow } from './parse';
import { CourseSyncScreen } from './screen';

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * Class timetable from PKU via the treehole course table (pkucli crates/treehole/src/api.rs
 * `get_coursetable` + `get_class_times`). Writes into the shared timetable with source "campus";
 * hand-added courses are never touched.
 */
export const courseSyncPlugin = definePlugin({
  id: 'course-sync',
  name: '教务课表',
  description: '从学校同步本学期课表到日程。',
  version: '0.1.0',
  i18n: {
    en: {
      name: 'Official timetable',
      description: 'Syncs this semester’s timetable from the university into Schedule.',
      tools: { sync: { title: 'Sync official timetable' }, sendCode: { title: 'Send verification code' } },
      screens: { home: { title: 'Official timetable' } },
      settings: { home: { title: 'Official timetable', subtitle: 'Sync your classes from the university' } },
    },
  },
  icon: 'book',
  requires: ['campus-session', 'network'],
  scopes: ['treehole.pku.edu.cn（课表）'],
  contributes: {
    screens: { home: { title: '教务课表', component: CourseSyncScreen } },
    settings: [{ screen: 'home', title: '教务课表', subtitle: '从学校同步课表', icon: 'book' }],
  },
  instructions: `用户想导入/同步/更新课表时调用 course-sync__sync。
- 已在「手机令牌」插件绑定时，课表二次验证会自动完成，不必问用户。
- 返回 status "verification_required" 时：kind "login" 只能用短信；kind "course" 可用手机令牌（OTP）或短信。用 ui__render 给用户一个输入验证码的表单（发短信前先调用 course-sync__sendCode），拿到验证码后再调用 sync 并传 code 和 method。
- 同步结果里 location 是从教务原文 info 解析出的教室；解析不到时为 null，可用 timetable__updateCourse 补上。`,
  tools: {
    sync: defineTool({
      title: '同步教务课表',
      description: 'Import this semester\'s classes from PKU into the timetable (replaces earlier synced classes, keeps manual ones). May return verification_required; then call again with the code.',
      input: z.object({
        code: z.string().trim().min(4).max(8).optional().describe('SMS or 手机令牌 code when a previous call asked for one'),
        method: z.enum(['sms', 'otp']).optional().describe('how the code was obtained; default sms'),
      }),
      effect: 'write',
      execute: async ({ code, method = 'sms' }, ctx) => {
        if (code) {
          const pending = (await ctx.kv.get<Pending>('pending')) ?? 'course';
          await redeem(ctx, pending, code, method);
          await ctx.kv.delete('pending');
        }
        let res = await call<{ course?: RawRow[] }>(ctx, '/chapi/api/getCoursetable_v2');
        // Course token with the harness's 手机令牌 bound: redeem a code ourselves (pkucli api.rs
        // course_token_exchange tries the local OTP first), then retry once.
        if (res.code === CODE_COURSE_TOKEN && !code) {
          const otp = await ctx.services.campus.otp().catch(() => null);
          if (otp) {
            await redeem(ctx, 'course', otp.code, 'otp').catch(() => {});
            res = await call<{ course?: RawRow[] }>(ctx, '/chapi/api/getCoursetable_v2');
          }
        }
        if (res.code === CODE_SMS_CHECK || res.code === CODE_COURSE_TOKEN) {
          const kind: Pending = res.code === CODE_SMS_CHECK ? 'login' : 'course';
          await ctx.kv.set('pending', kind);
          return {
            status: 'verification_required',
            kind,
            methods: kind === 'login' ? ['sms'] : ['otp', 'sms'],
            message: kind === 'login' ? '树洞需要短信验证（首次登录或定期验证）' : '查看课表需要二次验证：手机令牌验证码，或短信验证码',
          };
        }
        if (!res.success || !res.data?.course) throw new Error(`获取课表失败：${res.message ?? '没有课表数据'}`);

        const timetable = ctx.services.timetable;
        const total = timetable.get().semester?.weeks ?? 20;
        const meetings = parseCourseTable(res.data.course, total);
        const times = await call<{ list?: { name?: string; time_period?: string }[] }>(ctx, '/chapi/api/v3/classtimes/user_class_times', {})
          .then((r) => periodTimes(r.data?.list))
          .catch(() => periodTimes(undefined));

        for (const c of timetable.get().courses.filter((x) => x.source === 'campus')) await timetable.remove(c.id);
        const names = [...new Set(meetings.map((m) => m.name))];
        const base = timetable.get().courses.length;
        const added: Course[] = [];
        for (const m of meetings) {
          const start = times[m.firstPeriod]?.[0];
          const end = times[m.lastPeriod]?.[1];
          if (!start || !end) continue;
          const course: Course = {
            id: timetable.newId(),
            name: m.name,
            weekday: m.weekday,
            start,
            end,
            location: m.location,
            teacher: null,
            weeks: m.weeks,
            color: (base + names.indexOf(m.name)) % 8,
            source: 'campus',
          };
          await timetable.upsert(course);
          added.push(course);
        }
        await ctx.kv.set('lastSync', { at: Date.now(), count: added.length });
        return {
          status: 'synced',
          count: added.length,
          courses: meetings.map((m) => ({ name: m.name, day: WEEKDAY[m.weekday], periods: `${m.firstPeriod}-${m.lastPeriod}`, location: m.location, info: m.info })),
        };
      },
    }),
    sendCode: defineTool({
      title: '发送验证码',
      description: 'Send the SMS code that the last sync asked for (to the phone bound to the account).',
      input: z.object({}),
      effect: 'write',
      execute: async (_input, ctx) => {
        const pending = (await ctx.kv.get<Pending>('pending')) ?? 'course';
        return { sent: await sendCode(ctx, pending) };
      },
    }),
  },
});
