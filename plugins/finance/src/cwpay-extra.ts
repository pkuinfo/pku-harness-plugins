import type { HostServices } from '@pku-harness/sdk';

import { call, idserial, SCHOOL_CODE } from './cwpay';
import {
  catalogProjects,
  invoiceEndpoint,
  invoiceUrl,
  notice,
  orderDetail,
  pendingItems,
  summarizeOrders,
  type RawCatalogProject,
  type RawNotice,
  type RawOrderFull,
  type RawPending,
} from './cwpay-extra-parse';
import { statusDict } from './cwpay-parse';

/**
 * Read-only 北京大学收费平台 (cwpay.pku.edu.cn) calls behind cwpay-tools.ts, over the harness
 * `cwpay` session (IAAA sign-in, X-Token, decryption: src/core/campus/adapters/cwpay.ts).
 * Endpoints and bodies as the live mobile bundle sends them (2026-10-23, /mobile/js/app.43b046a6.js
 * and chunks); every one here only reads.
 */

type Services = Pick<HostServices, 'campus'>;
const DATA_SOURCE = 'PAY';
const PAGE = 50;

type OrderPage = { records?: RawOrderFull[]; total?: number; pages?: number };

/** /pay/web/order/pageOrderlist, the same body as cwpay.ts `queryOrders`. */
function orderPage(services: Services, page: number, opts: { from?: string; to?: string; project?: string; size?: number }) {
  return call<OrderPage>(services, '/pay/web/order/pageOrderlist', '订单记录', {
    pageCurrent: page,
    pageSize: opts.size ?? PAGE,
    projectName: opts.project ?? '',
    projectId: '',
    displayStatus: '',
    startCreateDate: opts.from ?? '',
    endCreateDate: opts.to ?? '',
    schoolCode: SCHOOL_CODE,
  });
}

/** Walk the order list (newest first), at most `maxPages` pages of 50. */
async function allOrders(services: Services, opts: { from?: string; to?: string; project?: string }, maxPages: number, stop?: (o: RawOrderFull) => boolean) {
  const out: RawOrderFull[] = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const data = await orderPage(services, page, opts);
    const records = Array.isArray(data?.records) ? data.records : [];
    total = Number(data?.total ?? 0) || total;
    out.push(...records);
    if ((stop && records.some(stop)) || records.length < PAGE || out.length >= total) return { orders: out, total, truncated: false };
  }
  return { orders: out, total, truncated: out.length < total };
}

const dict = (services: Services) =>
  call<unknown>(services, `common/com/dict/getDictDatasByTypes/TRADE_DISPLAY_STATUS/${SCHOOL_CODE}/${DATA_SOURCE}`, '订单状态').then(statusDict, () => statusDict(null));

/** POST pay/project/getAllProjectNoType {schoolCode}: every project, with suspension state. */
export async function queryCatalog(services: Services) {
  return catalogProjects(await call<RawCatalogProject[]>(services, 'pay/project/getAllProjectNoType', '缴费项目', { schoolCode: SCHOOL_CODE }));
}

/** 待缴费列表: the platform's own pending bills for this student, all projects. */
export async function queryPending(services: Services) {
  const rows = await call<RawPending[]>(services, `pay/pay/waitingPay/getWaitingPayList/${SCHOOL_CODE}/${encodeURIComponent(idserial(services))}/undefined`, '待缴费');
  return pendingItems(rows);
}

/** One order by its order number: list row (project, invoice) + getOrderById (channel, times). */
export async function queryOrderDetail(services: Services, orderNo: string) {
  const want = orderNo.trim();
  const [{ orders }, names] = await Promise.all([allOrders(services, {}, 6, (o) => o.orderNo === want), dict(services)]);
  const row = orders.find((o) => o.orderNo === want);
  if (!row) throw new Error(`在最近的订单里没有找到订单号 ${want}`);
  const detail = row.id != null ? await call<RawOrderFull>(services, `pay/pay/orderTrade/getOrderById/${encodeURIComponent(String(row.id))}`, '订单详情').catch(() => null) : null;
  const result = orderDetail(row, detail, names);
  let url: string | null = null;
  const endpoint = invoiceEndpoint(row.billType);
  if (row.billNo && endpoint) {
    url = await call<unknown>(services, endpoint, '电子票据', { billType: row.billType, billNo: row.billNo, schoolCode: SCHOOL_CODE }).then(invoiceUrl, () => null);
  }
  return { ...result, invoice: { ...result.invoice, url } };
}

/** Totals by project and month over the order list (date range on the creation date). */
export async function querySpending(services: Services, opts: { from?: string; to?: string; project?: string }) {
  const { orders, truncated } = await allOrders(services, opts, 10);
  return { ...summarizeOrders(orders), truncated };
}

/** The platform's home-page notice (popup), or null. */
export async function queryNotice(services: Services) {
  return notice(await call<RawNotice | null>(services, 'common/com/notice/getStuNotice', '平台公告', { schoolCode: SCHOOL_CODE, dataSource: DATA_SOURCE }));
}
