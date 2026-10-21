/**
 * Pure parsers for 北京大学收费平台 (cwpay.pku.edu.cn). The harness `cwpay` session decrypts the
 * answers; these read the `{messageCode, message, data}` envelope and the shapes the site's own
 * mobile bundle reads (2026-10-21, /mobile/js/chunk-*.js): field names below are cited from there.
 * Amounts are in fen (the SPA divides with `fenToYuan`).
 */

export type Envelope<T> = { messageCode?: string | number; message?: string; data?: T };

/** messageCode "0" / "6003" = ok (axios interceptor in app.js module b775). */
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

/** Untrusted server text: strip tags/control chars and cap the length. */
export const clean = (s: unknown, max = 120): string =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// ── Projects (缴费项目), chunk-3f0f2878 "moreMpplications" ───────────────────────────────────

export type RawProject = { id?: string | number; name?: string; projectName?: string; proModelUrl?: string; type?: string; isParentProject?: string; children?: RawProject[] | null };
export type PayProject = { id: string; name: string; kind: string; category: string };

/**
 * getProjectTypeAndProjectInfoListInit/<schoolCode> → categories `{id, name, children[]}`;
 * a child with `type === "1"` is a folder whose children come from
 * getProjectTypeAndProjectInfoList/<id>. `proModelUrl` names the payment page
 * (`/<proModelUrl>Pay`): tuitionAndDorm, bathRecharge, eCardRecharge, net, common, …
 */
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

/** Folder contents (getProjectTypeAndProjectInfoList/<id>) are a flat child list. */
export const folderProjects = (children: RawProject[], category: string) => flattenProjects([{ children }], category).projects;

export const isTuitionProject = (p: PayProject) => p.kind === 'tuitionAndDorm' || /学.*宿|学费|住宿费/.test(p.name);
export const isBathProject = (p: PayProject) => p.kind === 'bathRecharge' || /浴/.test(p.name);

// ── 学费住宿费, chunk-34087c56 (tuitionAndDormPay) ─────────────────────────────────────────────

export type RawTuition = { academicYear?: string; feeTypeName?: string; shouldpay?: number | string; paid?: number | string; note?: string };
export type TuitionItem = { year: string; item: string; due: number | null; paid: number | null; unpaid: number | null; note: string };

/** getTuitionAndDormList/<idserial>/<projectId>: one row per 学年 × 费用类型; `shouldpay - paid` unpaid. */
export function tuitionItems(rows: RawTuition[]): { items: TuitionItem[]; totals: { due: number; paid: number; unpaid: number } } {
  const items = (Array.isArray(rows) ? rows : []).map((r) => {
    const due = fenToYuan(r.shouldpay);
    const paid = fenToYuan(r.paid);
    const unpaid = due != null ? Math.round((due - (paid ?? 0)) * 100) / 100 : null;
    return { year: clean(r.academicYear, 20), item: clean(r.feeTypeName, 40), due, paid, unpaid, note: clean(r.note, 80) };
  });
  const sum = (k: 'due' | 'paid' | 'unpaid') => Math.round(items.reduce((a, i) => a + Math.max(0, i[k] ?? 0), 0) * 100) / 100;
  return { items, totals: { due: sum('due'), paid: sum('paid'), unpaid: sum('unpaid') } };
}

// ── 订单 (缴费记录), chunk-8158cdf6 (orderList) ───────────────────────────────────────────────

/** TRADE_DISPLAY_STATUS: the SPA reads the names from a dict; 101 = 待支付 (blue), 103 = 已付款. */
export const ORDER_STATUS: Record<string, string> = { '101': '待支付', '103': '已付款' };

export type RawOrder = { id?: string | number; orderNo?: string; projectName?: string; amount?: number | string; createDate?: string; displayStatus?: string | number; billNo?: string | null };
export type PayOrder = { orderNo: string; project: string; amount: number | null; createdAt: string; status: string; invoiced: boolean };

/** /pay/web/order/pageOrderlist → `{records[], total}`. */
export function orderRecords(data: { records?: RawOrder[]; total?: number } | null | undefined, statusNames: Record<string, string> = ORDER_STATUS): { total: number; orders: PayOrder[] } {
  const records = Array.isArray(data?.records) ? data.records : [];
  return {
    total: Number(data?.total ?? records.length) || records.length,
    orders: records.map((o) => {
      const code = String(o.displayStatus ?? '');
      return {
        orderNo: clean(o.orderNo, 40),
        project: clean(o.projectName, 60),
        amount: fenToYuan(o.amount),
        createdAt: clean(o.createDate, 20),
        status: statusNames[code] ?? (code ? `状态 ${code}` : '未知'),
        invoiced: !!o.billNo,
      };
    }),
  };
}

/** getDictDatasByTypes/TRADE_DISPLAY_STATUS/… → `{TRADE_DISPLAY_STATUS: [{key, value}]}`. */
export function statusDict(data: unknown): Record<string, string> {
  const list = (data as { TRADE_DISPLAY_STATUS?: { key?: unknown; value?: unknown }[] } | null)?.TRADE_DISPLAY_STATUS;
  const out: Record<string, string> = { ...ORDER_STATUS };
  if (Array.isArray(list)) for (const d of list) if (d?.key != null && d.value) out[String(d.key)] = clean(d.value, 20);
  return out;
}
