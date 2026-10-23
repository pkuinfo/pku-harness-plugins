import type { HostServices, KV, ToolEffect } from '../plugin';

/**
 * Host abilities (docs/PLUGIN-LANGUAGE.md §7): harness features a document plugin may use when it
 * lists the group in `abilities`. Each op has a fixed effect; the calling tool must declare at
 * least that effect. New abilities are added here (reviewed once), never by plugins.
 */

export function effectRank(e: ToolEffect): number {
  return e === 'read' ? 0 : e === 'write' ? 1 : 2;
}

type AbilityEnv = {
  services: HostServices;
  kv: KV;
  /** A request through the runner (declared hosts/services, limits), parsed as JSON. */
  request: (req: Record<string, unknown>) => Promise<unknown>;
};

export type AbilityDef = { effect: ToolEffect; description: string; run: (args: Record<string, unknown>, env: AbilityEnv) => Promise<unknown> };

// ---------------------------------------------------------------- treehole second factors

/** pkucli crates/treehole: 40002 = SMS check (verify.rs), 40077 = course-data token (api.rs get_legacy). */
const SMS_CHECK = 40002;
const COURSE_TOKEN = 40077;
type Pending = 'login' | 'course';
type Envelope = { code?: number; success?: boolean; message?: string; data?: unknown };

const th = (env: AbilityEnv, url: string, json?: unknown) => env.request({ campus: 'treehole', url, ...(json === undefined ? {} : { method: 'POST', json }) }) as Promise<Envelope>;

async function redeem(env: AbilityEnv, pending: Pending, code: string, via: 'sms' | 'otp') {
  const r =
    pending === 'login'
      ? await th(env, '/chapi/api/jwt_msg_verify', { valid_code: code })
      : via === 'otp'
        ? await th(env, '/chapi/api/course/password_get_token', { code })
        : await th(env, '/chapi/api/course/mobile_message_get_token', { code });
  if (!r.success) throw new Error(`验证失败：${r.message ?? '验证码不正确'}`);
}

async function treehole(args: Record<string, unknown>, env: AbilityEnv) {
  const req = { ...(args.request as Record<string, unknown>), campus: 'treehole' };
  const code = typeof args.code === 'string' && args.code.trim() ? args.code.trim() : undefined;
  if (code) {
    const pending = (await env.kv.get<Pending>('verify:pending')) ?? 'course';
    const via = args.via === 'sms' || args.via === 'otp' ? args.via : pending === 'login' ? 'sms' : 'otp';
    await redeem(env, pending, code, via);
    await env.kv.delete('verify:pending');
  }
  let res = (await env.request(req)) as Envelope;
  if (res.code === COURSE_TOKEN && !code) {
    const otp = await env.services.campus.otp().catch(() => null);
    if (otp) {
      await redeem(env, 'course', otp.code, 'otp').catch(() => {});
      res = (await env.request(req)) as Envelope;
    }
  }
  if (res.code === SMS_CHECK || res.code === COURSE_TOKEN) {
    const kind: Pending = res.code === SMS_CHECK ? 'login' : 'course';
    await env.kv.set('verify:pending', kind);
    return {
      status: 'verification_required',
      kind,
      methods: kind === 'login' ? ['sms'] : ['otp', 'sms'],
      message: kind === 'login' ? '树洞需要短信验证（首次登录或定期验证）' : '需要二次验证：手机令牌验证码，或短信验证码',
      next: 'Ask the user for the code (send an SMS first with the sendCode tool if they choose SMS), then call this tool again with code.',
    };
  }
  if (res.success === false) throw new Error(res.message ?? '树洞请求失败');
  return res.data ?? res;
}

async function treeholeSendCode(_args: Record<string, unknown>, env: AbilityEnv) {
  const pending = (await env.kv.get<Pending>('verify:pending')) ?? 'login';
  const url = pending === 'login' ? '/chapi/api/jwt_send_msg' : '/chapi/api/course/send_get_token_message';
  const r = await th(env, url, {});
  if (!r.success && !/未过期/.test(r.message ?? '')) throw new Error(`发送验证码失败：${r.message ?? '未知原因'}`);
  return { sent: true, message: r.success ? '验证码已发送到绑定手机' : `之前的验证码还有效（${r.message}）` };
}

// ---------------------------------------------------------------- the table

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const ABILITIES: Record<string, AbilityDef> = {
  'verify.treehole': { effect: 'read', description: 'Treehole request with SMS / OTP second factor handled', run: treehole },
  'verify.treeholeSendCode': { effect: 'write', description: 'Send the SMS code for the pending treehole check', run: treeholeSendCode },
  'otp.code': { effect: 'read', description: 'Current IAAA 手机令牌 code, or null', run: async (_a, e) => e.services.campus.otp() },
  'todos.list': { effect: 'read', description: 'The user’s to-dos', run: async (_a, e) => e.services.todos.list() },
  'todos.add': { effect: 'write', description: 'Add a to-do { title, notes?, dueAt?, remind? }', run: async (a, e) => e.services.todos.add(a as never, 'plugin') },
  'todos.update': { effect: 'write', description: 'Update a to-do { id, patch }', run: async (a, e) => e.services.todos.update(str(a.id), (a.patch ?? {}) as never, 'plugin') },
  'todos.setDone': { effect: 'write', description: 'Mark a to-do done { id, done }', run: async (a, e) => e.services.todos.setDone(str(a.id), a.done !== false) },
  'todos.remove': { effect: 'write', description: 'Remove a to-do { id }', run: async (a, e) => e.services.todos.remove(str(a.id)).then(() => ({ removed: true })) },
  'timetable.get': { effect: 'read', description: 'Courses and semester', run: async (_a, e) => e.services.timetable.get() },
  'timetable.upsert': {
    effect: 'write',
    description: 'Add or replace a course { course }',
    run: async (a, e) => {
      const course = { ...(a.course as Record<string, unknown>) };
      course.id ??= e.services.timetable.newId();
      await e.services.timetable.upsert(course as never);
      return course;
    },
  },
  'timetable.remove': { effect: 'write', description: 'Remove a course { id }', run: async (a, e) => e.services.timetable.remove(str(a.id)).then(() => ({ removed: true })) },
  'scheduler.list': { effect: 'read', description: 'Reminders and checks', run: async (_a, e) => e.services.scheduler.list() },
  'scheduler.create': { effect: 'write', description: 'Create a reminder or check (JobInput)', run: async (a, e) => e.services.scheduler.create(a as never) },
  'scheduler.update': { effect: 'write', description: 'Update a job { id, patch }', run: async (a, e) => e.services.scheduler.update(str(a.id), (a.patch ?? {}) as never) },
  'scheduler.remove': { effect: 'write', description: 'Remove a job { id }', run: async (a, e) => e.services.scheduler.remove(str(a.id)).then(() => ({ removed: true })) },
  'browser.open': { effect: 'read', description: 'Open an https URL outside the app { url }', run: async (a, e) => e.services.browser.open(str(a.url)) },
  'campusPage.open': { effect: 'read', description: 'Open a campus site signed in { service }', run: async (a, e) => e.services.campus.openSignedIn(str(a.service)) },
  'sms.awaitCode': { effect: 'read', description: 'One-tap SMS code (user allows reading one SMS)', run: async (_a, e) => ({ code: await e.services.sms.awaitCode() }) },
  'files.pick': { effect: 'read', description: 'Let the user pick files { types?, multiple? }', run: async (a, e) => e.services.files.pick(a as never) },
  'crypto.sha256': { effect: 'read', description: 'SHA-256 hex of text { text }', run: async (a, e) => e.services.crypto.sha256(str(a.text)) },
};

export const ABILITY_IDS = Object.keys(ABILITIES);
