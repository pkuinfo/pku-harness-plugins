/**
 * Pure helpers for the utilities plugin. Bath card data comes from 北京大学收费平台
 * (cwpay.pku.edu.cn) through the harness `cwpay` session, which decrypts the answers; shapes are
 * the ones the site's mobile bundle reads (2026-10-21, /mobile/js/chunk-09728569 浴卡充值,
 * chunk-8158cdf6 订单, chunk-3f0f2878 项目). Amounts from the server are in fen.
 */

export type Envelope<T> = { messageCode?: string | number; message?: string; data?: T };

/** messageCode "0" / "6003" = ok (the SPA's axios interceptor). */
export function unwrapCwpay<T>(body: string, what: string): T {
  let env: Envelope<T>;
  try {
    env = JSON.parse(body) as Envelope<T>;
  } catch {
    throw new Error(`收费平台返回了无法识别的内容（${what}）`);
  }
  const code = String(env?.messageCode ?? '');
  if (code !== '0' && code !== '6003') {
    const msg = typeof env?.data === 'string' && env.data ? env.data : env?.message;
    throw new Error(`收费平台：${msg || '请求失败'}（${what}）`);
  }
  return env.data as T;
}

export const fenToYuan = (fen: unknown): number | null => {
  const n = typeof fen === 'number' ? fen : typeof fen === 'string' && fen.trim() !== '' ? Number(fen) : NaN;
  return Number.isFinite(n) ? Math.round(n) / 100 : null;
};

/** Untrusted server text: no tags, no control characters, bounded length. */
export const clean = (s: unknown, max = 120): string =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** 2000012345 → 2000****45 (enough to recognise, not to copy). */
export function maskId(id: unknown): string | null {
  const s = clean(id, 40);
  if (!s) return null;
  if (s.length <= 4) return '*'.repeat(s.length);
  const keep = s.length <= 8 ? 2 : 4;
  return `${s.slice(0, keep)}${'*'.repeat(Math.max(2, s.length - keep - 2))}${s.slice(-2)}`;
}

// ── Projects ──────────────────────────────────────────────────────────────────────────────────

export type RawProject = { id?: string | number; name?: string; projectName?: string; proModelUrl?: string; type?: string; children?: RawProject[] | null };
export type PayProject = { id: string; name: string; kind: string; category: string };

/** getProjectTypeAndProjectInfoListInit/<schoolCode>: categories → children; type "1" = folder. */
export function flattenProjects(categories: RawProject[], category = ''): { projects: PayProject[]; folders: { id: string; category: string }[] } {
  const projects: PayProject[] = [];
  const folders: { id: string; category: string }[] = [];
  for (const c of categories ?? []) {
    const label = category || clean(c.name ?? c.projectName, 40);
    for (const p of c.children ?? []) {
      if (p?.id == null) continue;
      if (p.type === '1') folders.push({ id: String(p.id), category: `${label}>${clean(p.name ?? p.projectName, 40)}` });
      else projects.push({ id: String(p.id), name: clean(p.projectName ?? p.name, 60), kind: clean(p.proModelUrl, 40), category: label });
    }
  }
  return { projects, folders };
}

/** The 浴卡充值 project: route `/bathRechargePay` = proModelUrl "bathRecharge". */
export const isBathProject = (p: PayProject) => p.kind === 'bathRecharge' || /浴/.test(p.name);

/** What a project kind means for the user (null = a page this plugin doesn't know). */
export const PROJECT_KINDS: Record<string, string> = {
  tuitionAndDorm: '学费住宿费',
  bathRecharge: '浴卡充值',
  eCardRecharge: '校园卡充值',
  net: '网费',
  chargeElectricity: '电费（收费平台页面尚未实现）',
  heating: '供暖费',
  common: '通用缴费',
};

// ── 浴卡 ──────────────────────────────────────────────────────────────────────────────────────

/** The 浴卡充值 page's limits (chunk-09728569 `next`: 充值不能低于10元 / 不能高于100元). */
export const BATH_MIN = 10;
export const BATH_MAX = 100;
export const BATH_PRESETS = [20, 50, 100] as const;

export function checkBathAmount(amount: number): string | null {
  if (!Number.isFinite(amount)) return '请输入充值金额';
  if (amount < BATH_MIN) return `充值不能低于 ${BATH_MIN} 元`;
  if (amount > BATH_MAX) return `充值不能高于 ${BATH_MAX} 元`;
  if (Math.round(amount * 100) !== amount * 100) return '金额最多两位小数';
  return null;
}

/** pay/web/bath/queryBathFeeInfo/<idserial>/<projectId> → `{idserial, username}` (卡号, 姓名). */
export function bathCardInfo(data: { idserial?: unknown; username?: unknown } | null | undefined) {
  return { cardNo: maskId(data?.idserial), holder: clean(data?.username, 20) || null };
}

/** pay/web/bath/createOrder → `{PayOrderTrade: {id, …}}`. */
export function createdOrderId(data: { PayOrderTrade?: { id?: unknown } } | null | undefined): string {
  const id = data?.PayOrderTrade?.id;
  if (id == null || id === '') throw new Error('收费平台没有返回订单号');
  return String(id);
}

// ── Orders ────────────────────────────────────────────────────────────────────────────────────

export const ORDER_STATUS: Record<string, string> = { '101': '待支付', '103': '已付款' };
export type RawOrder = { orderNo?: string; projectName?: string; amount?: number | string; createDate?: string; displayStatus?: string | number };
export type BathTopUp = { amount: number | null; createdAt: string; status: string };

/** Bath top-ups among /pay/web/order/pageOrderlist records, newest first as the server sends them. */
export function bathTopUps(data: { records?: RawOrder[] } | null | undefined, limit = 5): BathTopUp[] {
  const records = Array.isArray(data?.records) ? data.records : [];
  return records
    .filter((o) => /浴/.test(String(o.projectName ?? '')))
    .slice(0, limit)
    .map((o) => {
      const code = String(o.displayStatus ?? '');
      return { amount: fenToYuan(o.amount), createdAt: clean(o.createDate, 20), status: ORDER_STATUS[code] ?? (code ? `状态 ${code}` : '未知') };
    });
}

// ── 电费 ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Where PKU dorm electricity lives today (checked 2026-10-21): 动力中心 sells it through the WeChat
 * service account only (dlzx.pku.edu.cn/fwzn/sndjf); the 收费平台 has a 电费 page that is a stub
 * (chunk-afa614c4: demo pickers, `next()` only alerts). No web API reaches the meters.
 */
export const ELECTRICITY_GUIDE =
  '宿舍电费目前只能在微信里交：关注公众号「动力中心收费服务号」→ 缴费服务 → 学生购电 → 用户绑定/解绑（首次绑定楼宇和房间）→ 充值；剩余电量也在那里看。也可以到学生宿舍 28 楼地下一层后勤服务大厅现场购电（每天 8:00–20:00，电话 62753157 / 62758015）。本 App 暂时查不到电量，也不能代缴。';

export const BATH_GUIDE =
  '浴卡余额存在卡片芯片里，线上查不到。线上充值成功后要拿浴卡到浴卡转存机上贴卡激活，钱才写进卡里；也可以去 31 楼（大浴室）西侧地下的浴卡服务窗口（9:00–22:50）。洗浴中遇到问题可打 62753116。';
