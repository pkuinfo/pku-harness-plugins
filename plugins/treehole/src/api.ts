import type { ToolContext } from '@pku-harness/sdk';

/** Treehole API envelope (pkucli crates/treehole/src/api.rs `ApiResp`). */
export type ApiResp<T> = { code?: number; success?: boolean; message?: string; data?: T };

/** 40002: the treehole SMS check (api.rs check_resp / verify.rs). */
export const CODE_SMS_CHECK = 40002;

/** Thrown by `v3` on code 40002; tools turn it into a `verification_required` result. */
export class NeedsSms extends Error {
  constructor() {
    super('树洞需要短信验证');
  }
}

export type VerificationRequired = { status: 'verification_required'; kind: 'login'; methods: ['sms']; message: string };

export const verificationRequired = (): VerificationRequired => ({
  status: 'verification_required',
  kind: 'login',
  methods: ['sms'],
  message: '树洞需要短信验证（首次登录或定期验证）。先调用 treehole__sendCode 发送验证码，再带上 code 重试。',
});

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

/**
 * `/chapi/api/v3<path>` (api.rs get / post_json / post_action + check_resp): 40002 → NeedsSms,
 * otherwise `success` decides. Returns `data` (may be undefined for actions).
 */
export async function v3<T = unknown>(ctx: ToolContext, path: string, body?: unknown): Promise<{ data: T | undefined; message: string }> {
  const r = await call<T>(ctx, `/chapi/api/v3${path}`, body);
  if (r.code === CODE_SMS_CHECK) throw new NeedsSms();
  if (!r.success) throw new Error(`树洞：${r.message || `请求失败（code ${r.code ?? '?'}）`}`);
  return { data: r.data, message: r.message ?? '' };
}

/** verify.rs handle_sms_verification: POST /chapi/api/jwt_send_msg. */
export async function sendCode(ctx: ToolContext) {
  const r = await call(ctx, '/chapi/api/jwt_send_msg', {});
  // "还未过期": an earlier code is still valid; the user can type that one.
  if (!r.success && !/未过期/.test(r.message ?? '')) throw new Error(`发送验证码失败：${r.message ?? '未知原因'}`);
  return r.success ? '验证码已发送到绑定手机' : `之前的验证码还有效（${r.message}）`;
}

/** verify.rs: POST /chapi/api/jwt_msg_verify { valid_code }. */
export async function redeem(ctx: ToolContext, code: string) {
  const r = await call(ctx, '/chapi/api/jwt_msg_verify', { valid_code: code });
  if (!r.success) throw new Error(`验证失败：${r.message ?? '验证码不正确'}`);
}

/**
 * Run a tool body with the SMS-check path: redeem `code` first when given, and turn a 40002 into
 * a `verification_required` result instead of an error (same contract as course-sync).
 */
export async function guarded<T>(ctx: ToolContext, code: string | undefined, run: () => Promise<T>): Promise<T | VerificationRequired> {
  if (code) await redeem(ctx, code);
  try {
    return await run();
  } catch (e) {
    if (e instanceof NeedsSms) return verificationRequired();
    throw e;
  }
}
