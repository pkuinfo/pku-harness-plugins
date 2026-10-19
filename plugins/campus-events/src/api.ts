import type { ToolContext } from '@pku-harness/sdk';

/**
 * Treehole v3 JSON calls (pkucli crates/treehole/src/api.rs `get` + `check_resp`). The calendars
 * don't need the course-data token, only the treehole session; code 40002 is the periodic SMS
 * check (verify.rs), handled like course-sync (helpers copied, plugins never import each other).
 */
export type ApiResp<T> = { code?: number; success?: boolean; message?: string; data?: T };

export const CODE_SMS_CHECK = 40002;

export const SMS_REQUIRED = {
  status: 'verification_required',
  kind: 'login',
  methods: ['sms'],
  message: '树洞需要短信验证（首次登录或定期验证）',
} as const;

async function call<T>(ctx: ToolContext, url: string, body?: unknown): Promise<ApiResp<T>> {
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

/** GET a v3 path; `null` means treehole wants the SMS check first. Redeems `code` first when given. */
export async function getV3<T>(ctx: ToolContext, path: string, code: string | undefined, what: string): Promise<T | null> {
  if (code) {
    const r = await call(ctx, '/chapi/api/jwt_msg_verify', { valid_code: code });
    if (!r.success) throw new Error(`验证失败：${r.message ?? '验证码不正确'}`);
  }
  const res = await call<T>(ctx, `/chapi/api/v3${path}`);
  if (res.code === CODE_SMS_CHECK) return null;
  if (!res.success) throw new Error(`获取${what}失败：${res.message ?? '未知错误'}`);
  return (res.data ?? {}) as T;
}

/** verify.rs handle_sms_verification: send the login SMS ("还未过期" = the last one still works). */
export async function sendLoginCode(ctx: ToolContext) {
  const r = await call(ctx, '/chapi/api/jwt_send_msg', {});
  if (!r.success && !/未过期/.test(r.message ?? '')) throw new Error(`发送验证码失败：${r.message ?? '未知原因'}`);
  return r.success ? '验证码已发送到绑定手机' : `之前的验证码还有效（${r.message}）`;
}
