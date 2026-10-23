/**
 * Pure parsers for the read-only 北京大学收费平台 (cwpay.pku.edu.cn) features behind cwpay-tools.ts.
 * Shapes captured from the live site (2026-10-23, mobile bundle /mobile/js/app.43b046a6.js and
 * chunks; responses decrypted by the harness `cwpay` session). Amounts are in fen.
 */
import { clean, fenToYuan, ORDER_STATUS, type RawOrder } from './cwpay-parse';

// ── Catalog: POST pay/project/getAllProjectNoType {schoolCode} (home page "全部应用") ──────────

export type RawCatalogProject = {
  id?: string | number;
  projectName?: string;
  engName?: string | null;
  proModelUrl?: string | null;
  payamt?: number | string | null;
  status?: string | null;
  isSuspend?: string | null;
  suspendTip?: string | null;
  receiptMust?: string | null;
};

export type CatalogProject = {
  id: string;
  name: string;
  nameEn: string;
  kind: string;
  kindLabel: string;
  /** Standard amount in yuan when the project has one (payamt > 0). */
  standardAmount: number | null;
  /** status YES and not suspended. */
  open: boolean;
  /** Only while suspended: the platform's maintenance note (suspendTip). */
  suspendedNote: string | null;
  invoiceRequired: boolean;
};

/** proModelUrl → the payment page `/<kind>Pay`; labels for the kinds seen live. */
export const KIND_LABELS: Record<string, string> = {
  tuitionAndDorm: '学费住宿费',
  bathRecharge: '浴卡充值',
  net: '网费',
  eCardRecharge: '一卡通充值',
  hospital: '校园卡就诊账户',
  party: '党费',
  medicalParty: '党费（医学部）',
  union: '工会会费',
  carFaculty: '车证',
  carCooperation: '车证',
  heating: '供暖费',
  xiaojiaheRecharge: '肖家河租金',
  newPark: '中关新园',
  scene: '现场/窗口收费',
  common: '其他缴费',
  meeting: '会议费',
};

export function catalogProjects(rows: RawCatalogProject[] | null | undefined): CatalogProject[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((p) => p?.id != null && (p.projectName ?? '') !== '')
    .map((p) => {
      const kind = clean(p.proModelUrl, 40);
      const fen = fenToYuan(p.payamt);
      const suspended = p.isSuspend === 'YES';
      return {
        id: String(p.id),
        name: clean(p.projectName, 60),
        nameEn: clean(p.engName, 80),
        kind,
        kindLabel: KIND_LABELS[kind] ?? kind,
        standardAmount: fen != null && fen > 0 ? fen : null,
        open: (p.status ?? 'YES') === 'YES' && !suspended,
        suspendedNote: suspended ? clean(p.suspendTip, 200) || null : null,
        invoiceRequired: p.receiptMust === 'YES',
      };
    });
}

/** Keyword (name, English name or kind label) and kind filter. */
export function filterCatalog(projects: CatalogProject[], opts: { search?: string; kind?: string }): CatalogProject[] {
  const q = opts.search?.trim().toLowerCase();
  return projects.filter((p) => {
    if (opts.kind && p.kind !== opts.kind) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q) || p.kindLabel.toLowerCase().includes(q);
  });
}

// ── 待缴费: GET pay/pay/waitingPay/getWaitingPayList/<schoolCode>/<idserial>/<projectId> ──────
// The PC "待缴费列表" (/student/model/waitingPay) and mobile balanceInquiry pass no project, so the
// last segment is literally "undefined" (= every project). Fields from chunk-5dcd1bc5.

export type RawPending = {
  projectId?: string | number;
  projectName?: string;
  batchno?: string | null;
  payamt?: number | string | null;
  unpaidamt?: number | string | null;
  payLimit?: number | string | null;
};

export type PendingItem = { project: string; batch: string; due: number | null; unpaid: number | null; partialAllowed: boolean };

/** payLimit -1 / 0 / null = must pay in full (the SPA's `check()`). */
export function pendingItems(rows: RawPending[] | null | undefined): { items: PendingItem[]; totalUnpaid: number } {
  const items = (Array.isArray(rows) ? rows : []).map((r) => {
    const limit = r.payLimit == null ? null : String(r.payLimit);
    return {
      project: clean(r.projectName, 60),
      batch: clean(r.batchno, 60),
      due: fenToYuan(r.payamt),
      unpaid: fenToYuan(r.unpaidamt),
      partialAllowed: limit !== null && limit !== '-1' && limit !== '0',
    };
  });
  const totalUnpaid = Math.round(items.reduce((a, i) => a + Math.max(0, i.unpaid ?? 0), 0) * 100) / 100;
  return { items, totalUnpaid };
}

// ── Order detail: GET pay/pay/orderTrade/getOrderById/<id> + the list row ─────────────────────

/** pay/channel/getChannelList {schoolCode, partnerId "PT000004"} as listed live (2026-10-23). */
export const PAY_CHANNELS: Record<string, string> = {
  '01': '支付宝',
  '02': '微信',
  '08': '建行网银',
  '09': '建行大额转账',
  '61': '中行外卡',
  '71': '数字货币',
};

export type RawOrderFull = RawOrder & {
  payableAmount?: number | string | null;
  tradeChannel?: string | null;
  actualCloseTime?: string | null;
  status?: string | null;
  productDesc?: string | null;
  receiptMust?: string | null;
  billType?: string | null;
  refundAmount?: number | string | null;
};

export type OrderDetail = {
  orderNo: string;
  project: string;
  amount: number | null;
  payable: number | null;
  refunded: number | null;
  status: string;
  createdAt: string;
  /** actualCloseTime: payment time for paid orders, close time for expired/cancelled ones. */
  closedAt: string;
  paidBy: string | null;
  invoice: { required: boolean; issued: boolean; billType: string | null };
};

/** Merge the list row (has projectName, billNo, billType) with getOrderById (has the rest). */
export function orderDetail(row: RawOrderFull, detail: RawOrderFull | null | undefined, statusNames: Record<string, string> = ORDER_STATUS): OrderDetail {
  const d = { ...row, ...Object.fromEntries(Object.entries(detail ?? {}).filter(([, v]) => v != null)) } as RawOrderFull;
  const code = String(d.displayStatus ?? '');
  const channel = d.tradeChannel ? String(d.tradeChannel) : '';
  const refunded = fenToYuan(d.refundAmount);
  return {
    orderNo: clean(d.orderNo, 40),
    project: clean(row.projectName ?? d.projectName ?? d.productDesc, 60).replace(/&$/, ''),
    amount: fenToYuan(d.amount),
    payable: fenToYuan(d.payableAmount),
    refunded: refunded && refunded > 0 ? refunded : null,
    status: statusNames[code] ?? (code ? `状态 ${code}` : '未知'),
    createdAt: clean(d.createDate, 20),
    closedAt: clean(d.actualCloseTime, 20),
    paidBy: channel ? (PAY_CHANNELS[channel] ?? `渠道 ${clean(channel, 8)}`) : null,
    invoice: { required: d.receiptMust === 'YES', issued: !!row.billNo, billType: row.billType ? clean(row.billType, 20) : null },
  };
}

/**
 * 查看发票 (orderList `lookInvoice`): billType HANGXIN → /pay/pay/invoiced/getEBillPicUrl,
 * BOSI → /pay/pay/invoiced/getCouldEBillPicUrl; body {billType, billNo, schoolCode}; data = URL.
 */
export function invoiceEndpoint(billType: string | null | undefined): string | null {
  if (billType === 'HANGXIN') return '/pay/pay/invoiced/getEBillPicUrl';
  if (billType === 'BOSI') return '/pay/pay/invoiced/getCouldEBillPicUrl';
  return null;
}

/** Only an http(s) URL, capped; anything else is dropped. */
export function invoiceUrl(data: unknown): string | null {
  const s = typeof data === 'string' ? data.trim() : '';
  return /^https?:\/\/[^\s<>"]+$/i.test(s) && s.length <= 2000 ? s : null;
}

// ── Spending summary over pageOrderlist (the site's own 缴费账单 stats answer -1 for everyone) ──

/** Count as money paid: 支付成功 and 部分退款 (minus the refund when known). */
const PAID = new Set(['103', '107']);

export type SpendingSummary = {
  orders: number;
  paid: { count: number; total: number };
  pending: number;
  byProject: { project: string; count: number; total: number }[];
  byMonth: { month: string; count: number; total: number }[];
};

export function summarizeOrders(rows: RawOrderFull[]): SpendingSummary {
  const proj = new Map<string, { count: number; total: number }>();
  const month = new Map<string, { count: number; total: number }>();
  let count = 0;
  let total = 0;
  let pending = 0;
  for (const o of rows) {
    const code = String(o.displayStatus ?? '');
    if (code === '101' || code === '102') pending++;
    if (!PAID.has(code)) continue;
    const amt = Math.max(0, (fenToYuan(o.amount) ?? 0) - (fenToYuan(o.refundAmount) ?? 0));
    count++;
    total += amt;
    const p = clean(o.projectName ?? o.productDesc, 60).replace(/&$/, '') || '未知项目';
    const m = clean(o.createDate, 20).slice(0, 7) || '未知';
    for (const [map, key] of [
      [proj, p],
      [month, m],
    ] as const) {
      const cur = map.get(key) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total = Math.round((cur.total + amt) * 100) / 100;
      map.set(key, cur);
    }
  }
  return {
    orders: rows.length,
    paid: { count, total: Math.round(total * 100) / 100 },
    pending,
    byProject: [...proj].map(([project, v]) => ({ project, ...v })).sort((a, b) => b.total - a.total),
    byMonth: [...month].map(([m, v]) => ({ month: m, ...v })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

// ── Notice: POST common/com/notice/getStuNotice {schoolCode, dataSource} (home popup) ─────────

export type RawNotice = { title?: string | null; content?: string | null; updateDate?: string | null };

/** null when the platform has no notice up (data null, or no title: the SPA shows nothing). */
export function notice(data: RawNotice | null | undefined): { title: string; content: string; updatedAt: string } | null {
  if (!data || !clean(data.title)) return null;
  const content = String(data.content ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n');
  return { title: clean(data.title, 120), content: clean(content, 1500), updatedAt: clean(data.updateDate, 20) };
}
