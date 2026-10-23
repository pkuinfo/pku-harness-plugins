/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { queryOrderDetail, queryPending, querySpending } from './cwpay-extra';
import { catalogProjects, filterCatalog, invoiceEndpoint, invoiceUrl, notice, orderDetail, pendingItems, summarizeOrders, type RawCatalogProject, type RawNotice, type RawOrderFull, type RawPending } from './cwpay-extra-parse';
import { ORDER_STATUS, unwrapCwpay, unwrapTuition } from './cwpay-parse';

const read = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();

type Req = { url: string; method?: string; body?: string };

/** A fake `services.campus` answering by URL prefix; records every request. */
function fakeServices(routes: [string, (req: Req) => unknown][]) {
  const seen: Req[] = [];
  return {
    seen,
    services: {
      campus: {
        status: () => ({ signedIn: true, username: '2600000000', name: null }),
        request: async (_service: string, req: Req) => {
          seen.push(req);
          const hit = routes.find(([prefix]) => req.url.includes(prefix));
          const body = hit ? hit[1](req) : { messageCode: '8100', message: '服务异常', data: '' };
          return { status: 200, url: req.url, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) };
        },
      },
    } as never,
  };
}

describe('tuition "无欠费"', () => {
  test('0001 无欠费 is an empty list, other errors still throw', async () => {
    expect(unwrapTuition(await read('cwpay-tuition-none.json'))).toEqual([]);
    expect(unwrapTuition(await read('cwpay-tuition.json'))).toHaveLength(3);
    expect(() => unwrapTuition('{"messageCode":"0001","message":"其他错误"}')).toThrow('其他错误');
  });
});

describe('catalog', () => {
  test('open/suspended, standard amount, markup stripped, bad rows dropped', async () => {
    const p = catalogProjects(unwrapCwpay<RawCatalogProject[]>(await read('cwpay-catalog.json'), 'c'));
    expect(p.map((x) => [x.id, x.kindLabel, x.open, x.standardAmount, x.invoiceRequired])).toEqual([
      ['c-tuition', '学费住宿费', false, null, false],
      ['c-bath', '浴卡充值', true, null, true],
      ['c-car', '其他缴费', true, 540, false],
      ['c-copy', '现场/窗口收费', true, null, false],
    ]);
    expect(p[0].suspendedNote).toContain('线上交费临时关闭');
    // a stale suspendTip on an open project is not shown
    expect(p[1].suspendedNote).toBeNull();
    expect(p[3].name).toBe('图书馆复印打印费');
  });
  test('filter by keyword (zh/en/label) and kind', async () => {
    const p = catalogProjects(unwrapCwpay<RawCatalogProject[]>(await read('cwpay-catalog.json'), 'c'));
    expect(filterCatalog(p, { search: '车证' }).map((x) => x.id)).toEqual(['c-car']);
    expect(filterCatalog(p, { search: 'BATH' }).map((x) => x.id)).toEqual(['c-bath']);
    expect(filterCatalog(p, { kind: 'scene' }).map((x) => x.id)).toEqual(['c-copy']);
    expect(filterCatalog(p, {})).toHaveLength(4);
  });
});

describe('pending', () => {
  test('fen → yuan, partial flag, total', async () => {
    const r = pendingItems(unwrapCwpay<RawPending[]>(await read('cwpay-pending.json'), 'w'));
    expect(r.items).toEqual([
      { project: '教材费', batch: '2026秋季教材', due: 320.5, unpaid: 320.5, partialAllowed: false },
      { project: '会议注册费', batch: '第一批', due: 1000, unpaid: 400, partialAllowed: true },
    ]);
    expect(r.totalUnpaid).toBe(720.5);
    expect(pendingItems(null)).toEqual({ items: [], totalUnpaid: 0 });
  });
  test('request path mirrors the SPA (…/<school>/<idserial>/undefined)', async () => {
    const { services, seen } = fakeServices([['getWaitingPayList', () => ({ messageCode: '0', data: [] })]]);
    expect(await queryPending(services)).toEqual({ items: [], totalUnpaid: 0 });
    expect(seen[0].url).toBe('pay/pay/waitingPay/getWaitingPayList/10001/2600000000/undefined');
    expect(seen[0].method).toBe('GET');
  });
});

describe('order detail', () => {
  test('merge list row and getOrderById; channel name; invoice flags', async () => {
    const f = JSON.parse(await read('cwpay-order-detail.json')) as { row: RawOrderFull; detail: { data: RawOrderFull } };
    expect(orderDetail(f.row, f.detail.data)).toEqual({
      orderNo: '26090100000000000001',
      project: '浴卡充值',
      amount: 50,
      payable: 50,
      refunded: null,
      status: '已付款',
      createdAt: '2026-09-01 15:41:37',
      closedAt: '2026-09-01 15:42:05',
      paidBy: '微信',
      invoice: { required: true, issued: true, billType: 'HANGXIN' },
    });
    expect(orderDetail({ orderNo: '1', displayStatus: '005', tradeChannel: '99' }, null).paidBy).toBe('渠道 99');
    expect(orderDetail({ orderNo: '1', displayStatus: '005' }, null).status).toBe('已过期');
  });
  test('invoice endpoints and URL guard', () => {
    expect(invoiceEndpoint('HANGXIN')).toBe('/pay/pay/invoiced/getEBillPicUrl');
    expect(invoiceEndpoint('BOSI')).toBe('/pay/pay/invoiced/getCouldEBillPicUrl');
    expect(invoiceEndpoint(null)).toBeNull();
    expect(invoiceUrl('https://bill.example.com/x?id=1')).toBe('https://bill.example.com/x?id=1');
    expect(invoiceUrl('javascript:alert(1)')).toBeNull();
    expect(invoiceUrl({ url: 'https://x' })).toBeNull();
  });
  test('finds the order by number, fetches detail and the invoice link (read-only calls only)', async () => {
    const f = JSON.parse(await read('cwpay-order-detail.json')) as { row: RawOrderFull; detail: unknown };
    const { services, seen } = fakeServices([
      ['pageOrderlist', () => ({ messageCode: '0', data: { total: 1, records: [f.row] } })],
      ['getDictDatasByTypes', () => ({ messageCode: '0', data: { TRADE_DISPLAY_STATUS: [{ key: '103', value: '支付成功' }] } })],
      ['getOrderById/o-1', () => f.detail],
      ['getEBillPicUrl', () => ({ messageCode: '0', data: 'https://bill.example.com/e/1' })],
    ]);
    const r = await queryOrderDetail(services, '26090100000000000001');
    expect(r.status).toBe('支付成功');
    expect(r.paidBy).toBe('微信');
    expect(r.invoice.url).toBe('https://bill.example.com/e/1');
    expect(JSON.parse(seen.find((s) => s.url.includes('getEBillPicUrl'))!.body!)).toEqual({ billType: 'HANGXIN', billNo: 'E0001', schoolCode: '10001' });
    expect(seen.every((s) => !/create|close|update|delete|submit/i.test(s.url))).toBe(true);
    await expect(queryOrderDetail(services, '999')).rejects.toThrow('没有找到订单号 999');
  });
});

describe('spending', () => {
  const rows: RawOrderFull[] = [
    { projectName: '浴卡充值', amount: 5000, createDate: '2026-10-02 10:00:00', displayStatus: '103' },
    { projectName: '浴卡充值', amount: 3000, createDate: '2026-09-02 10:00:00', displayStatus: '103' },
    { projectName: '网费充值', amount: 2000, refundAmount: 500, createDate: '2026-09-05 10:00:00', displayStatus: '107' },
    { projectName: '学费住宿费', amount: 500000, createDate: '2026-08-24 10:00:00', displayStatus: '005' },
    { projectName: '会议费', amount: 1000, createDate: '2026-10-03 10:00:00', displayStatus: '101' },
    { productDesc: '校园卡就诊账户充值&', amount: 10000, createDate: '2026-09-01 10:00:00', displayStatus: '108' },
  ];
  test('paid + partial refund (net), pending counted, expired/refunded excluded', () => {
    expect(summarizeOrders(rows)).toEqual({
      orders: 6,
      paid: { count: 3, total: 95 },
      pending: 1,
      byProject: [
        { project: '浴卡充值', count: 2, total: 80 },
        { project: '网费充值', count: 1, total: 15 },
      ],
      byMonth: [
        { month: '2026-09', count: 2, total: 45 },
        { month: '2026-10', count: 1, total: 50 },
      ],
    });
  });
  test('pages through the list until the total is reached', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ projectName: '浴卡充值', amount: 100, createDate: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, displayStatus: '103' }));
    const { services, seen } = fakeServices([
      [
        'pageOrderlist',
        (req) => {
          const p = (JSON.parse(req.body!) as { pageCurrent: number }).pageCurrent;
          return { messageCode: '0', data: { total: 70, records: p === 1 ? page(50) : page(20) } };
        },
      ],
    ]);
    const r = await querySpending(services, { from: '2026-10-01' });
    expect(r.paid).toEqual({ count: 70, total: 70 });
    expect(r.truncated).toBe(false);
    expect(seen).toHaveLength(2);
    expect(JSON.parse(seen[0].body!)).toMatchObject({ startCreateDate: '2026-10-01', schoolCode: '10001', pageSize: 50 });
  });
});

describe('notice', () => {
  test('title + flattened content; null when none', async () => {
    expect(notice(unwrapCwpay<RawNotice>(await read('cwpay-notice.json'), 'n'))).toEqual({ title: '系统维护通知', content: '本周六 0:00-6:00 系统维护 期间暂停缴费', updatedAt: '2026-10-20 09:00:00' });
    expect(notice(null)).toBeNull();
    expect(notice({ title: '', content: 'x' })).toBeNull();
  });
});

describe('status codes', () => {
  test('full TRADE_DISPLAY_STATUS fallback', () => {
    expect(Object.keys(ORDER_STATUS).sort()).toEqual(['005', '006', '101', '102', '103', '104', '107', '108']);
  });
});
