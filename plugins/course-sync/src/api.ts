import type { ToolContext } from '@pku-harness/sdk';

/** Treehole API envelope (pkucli crates/treehole/src/api.rs `ApiResp`). */
export type ApiResp<T> = { code?: number; success?: boolean; message?: string; data?: T };

/** 40002: the treehole SMS check (verify.rs); 40077: course-data token (api.rs get_legacy). */
export const CODE_SMS_CHECK = 40002;
export const CODE_COURSE_TOKEN = 40077;

export type Pending = 'login' | 'course';

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
