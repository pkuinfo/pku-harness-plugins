import type { ToolContext } from '@pku-harness/sdk';

import type { RawScoreData } from './parse';

/**
 * Treehole JSON calls and the second-factor steps, copied from course-sync (plugins never import
 * each other). pkucli crates/treehole/src/api.rs `ApiResp` / `get_legacy` / `course_token_exchange_*`.
 */
export type ApiResp<T> = { code?: number; success?: boolean; message?: string; data?: T };

/** 40002: the treehole SMS check (verify.rs); 40077: course-data token (api.rs get_legacy). */
export const CODE_SMS_CHECK = 40002;
export const CODE_COURSE_TOKEN = 40077;

export type Pending = 'login' | 'course';

export type Verification = {
  status: 'verification_required';
  kind: Pending;
  methods: ('sms' | 'otp')[];
  message: string;
};

export async function call<T>(ctx: ToolContext, url: string, body?: unknown): Promise<ApiResp<T>> {
  const res = await ctx.services.campus.request('treehole', {
    url,
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    contentType: body === undefined ? undefined : 'application/json',
  });
  try {
    return JSON.parse(res.body) as ApiResp<T>;
  } catch {
    throw new Error(`树洞返回了无法解析的内容（HTTP ${res.status}）`);
  }
}

/** Send the SMS for the pending step (verify.rs handle_sms_verification / api.rs course_token_exchange_with_sms). */
export async function sendCode(ctx: ToolContext, pending: Pending) {
  const url = pending === 'login' ? '/chapi/api/jwt_send_msg' : '/chapi/api/course/send_get_token_message';
  const r = await call(ctx, url, {});
  // "还未过期": an earlier code is still valid; the user can type that one.
  if (!r.success && !/未过期/.test(r.message ?? '')) throw new Error(`发送验证码失败：${r.message ?? '未知原因'}`);
  return r.success ? '验证码已发送到绑定手机' : `之前的验证码还有效（${r.message}）`;
}

/** Redeem a code for the pending step. `otp` = 手机令牌 code (course step only). */
export async function redeem(ctx: ToolContext, pending: Pending, code: string, method: 'sms' | 'otp') {
  const r =
    pending === 'login'
      ? await call(ctx, '/chapi/api/jwt_msg_verify', { valid_code: code })
      : method === 'otp'
        ? await call(ctx, '/chapi/api/course/password_get_token', { code })
        : await call(ctx, '/chapi/api/course/mobile_message_get_token', { code });
  if (!r.success) throw new Error(`验证失败：${r.message ?? '验证码不正确'}`);
}

/**
 * `GET /chapi/api/course/score_v2` (api.rs get_scores via get_legacy). Redeems `code` first when
 * given; returns a verification step instead of throwing when treehole asks for one.
 */
export async function fetchScores(ctx: ToolContext, code: string | undefined, method: 'sms' | 'otp'): Promise<RawScoreData | Verification> {
  if (code) {
    const pending = (await ctx.kv.get<Pending>('pending')) ?? 'course';
    await redeem(ctx, pending, code, method);
    await ctx.kv.delete('pending');
  }
  let res = await call<RawScoreData>(ctx, '/chapi/api/course/score_v2');
  // Course token with the harness's 手机令牌 bound: redeem a code ourselves (pkucli api.rs
  // course_token_exchange tries the local OTP first), then retry once.
  if (res.code === CODE_COURSE_TOKEN && !code) {
    const otp = await ctx.services.campus.otp().catch(() => null);
    if (otp) {
      await redeem(ctx, 'course', otp.code, 'otp').catch(() => {});
      res = await call<RawScoreData>(ctx, '/chapi/api/course/score_v2');
    }
  }
  if (res.code === CODE_SMS_CHECK || res.code === CODE_COURSE_TOKEN) {
    const kind: Pending = res.code === CODE_SMS_CHECK ? 'login' : 'course';
    await ctx.kv.set('pending', kind);
    return {
      status: 'verification_required',
      kind,
      methods: kind === 'login' ? ['sms'] : ['otp', 'sms'],
      message: kind === 'login' ? '树洞需要短信验证（首次登录或定期验证）' : '查看成绩需要二次验证：手机令牌验证码，或短信验证码',
    };
  }
  if (!res.success || !res.data) throw new Error(`获取成绩失败：${res.message ?? '没有成绩数据'}`);
  return res.data;
}
