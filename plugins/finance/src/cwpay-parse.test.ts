/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { clean, fenToYuan, flattenProjects, folderProjects, isBathProject, isTuitionProject, orderRecords, statusDict, tuitionItems, unwrapCwpay, type RawOrder, type RawProject, type RawTuition } from './cwpay-parse';
import { rewardsBetween, rewardsByMonth, rewardTotals, type RewardRecord } from './parse';

const read = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();

describe('envelope', () => {
  test('live error answer (HTTP 500, plain JSON) throws with the message', async () => {
    const body = await read('cwpay-error.json');
    expect(() => unwrapCwpay(body, '缴费项目')).toThrow('收费平台：服务异常，请稍后再试（缴费项目）');
  });
  test('6003 counts as ok; data string is the message on failure', () => {
    expect(unwrapCwpay<number>('{"messageCode":"6003","data":1}', 'x')).toBe(1);
    expect(() => unwrapCwpay('{"messageCode":"1","data":"项目未开放"}', 'x')).toThrow('项目未开放');
    expect(() => unwrapCwpay('<html>', 'x')).toThrow('无法识别');
  });
});

describe('projects', () => {
  test('categories, folders, kinds', async () => {
    const { projects, folders } = flattenProjects(unwrapCwpay<RawProject[]>(await read('cwpay-projects.json'), 'p'));
    expect(projects.map((p) => [p.id, p.kind, p.category])).toEqual([
      ['p-tuition', 'tuitionAndDorm', '学生缴费'],
      ['p-bath', 'bathRecharge', '学生缴费'],
      ['p-net', 'net', '生活服务'],
    ]);
    expect(folders).toEqual([{ id: 'f-more', category: '学生缴费>其他' }]);
    expect(projects.filter(isTuitionProject).map((p) => p.id)).toEqual(['p-tuition']);
    expect(projects.filter(isBathProject).map((p) => p.id)).toEqual(['p-bath']);
  });
  test('folder contents', () => {
    expect(folderProjects([{ id: 9, projectName: '党费', proModelUrl: 'party' }], '学生缴费>其他')).toEqual([{ id: '9', name: '党费', kind: 'party', category: '学生缴费>其他' }]);
  });
});

describe('tuition', () => {
  test('fen → yuan, unpaid per row and totals; markup stripped', async () => {
    const r = tuitionItems(unwrapCwpay<RawTuition[]>(await read('cwpay-tuition.json'), 't'));
    expect(r.items[0]).toEqual({ year: '2026-2027', item: '学费', due: 5000, paid: 0, unpaid: 5000, note: '' });
    expect(r.items[2].note).toBe('已缴');
    expect(r.totals).toEqual({ due: 11200, paid: 6200, unpaid: 5000 });
  });
  test('empty', () => {
    expect(tuitionItems([])).toEqual({ items: [], totals: { due: 0, paid: 0, unpaid: 0 } });
  });
});

describe('orders', () => {
  test('status names, amounts, invoice flag', async () => {
    const r = orderRecords(unwrapCwpay<{ records: RawOrder[]; total: number }>(await read('cwpay-orders.json'), 'o'));
    expect(r.total).toBe(3);
    expect(r.orders.map((o) => [o.project, o.amount, o.status, o.invoiced])).toEqual([
      ['浴卡充值', 50, '已付款', false],
      ['学费住宿费', 5000, '待支付', false],
      ['网费充值', 30, '状态 105', true],
    ]);
  });
  test('dict overrides and extends', () => {
    const names = statusDict({ TRADE_DISPLAY_STATUS: [{ key: '105', value: '已退款' }] });
    expect(names['105']).toBe('已退款');
    expect(names['101']).toBe('待支付');
    expect(statusDict(null)['103']).toBe('已付款');
    expect(orderRecords(null)).toEqual({ total: 0, orders: [] });
  });
});

describe('helpers', () => {
  test('fenToYuan / clean', () => {
    expect(fenToYuan(12345)).toBe(123.45);
    expect(fenToYuan('100')).toBe(1);
    expect(fenToYuan('')).toBeNull();
    expect(clean('a\n<i>b</i>\u0000c', 10)).toBe('a b c');
  });
});

describe('rewardsByMonth', () => {
  const rec = (paidAt: string, net: number, enteredAt = ''): RewardRecord => ({
    item: 'x', projectCode: '', payoutMethod: '', gross: net, tax: 0, net,
    status: paidAt ? 'paid' : 'pending', paidAt: paidAt || null, enteredAt, submittedBy: '', payingUnit: '',
  });
  test('groups by paid month, sorted', () => {
    expect(rewardsByMonth([rec('2026-03-10', 100), rec('2026-01-05', 50.5), rec('2026-03-20', 0.25), rec('', 1)])).toEqual([
      { month: '2026-01', count: 1, gross: 50.5, tax: 0, net: 50.5 },
      { month: '2026-03', count: 2, gross: 100.25, tax: 0, net: 100.25 },
      { month: '未知', count: 1, gross: 1, tax: 0, net: 1 },
    ]);
  });
});

describe('rewardsBetween', () => {
  const rec = (paidAt: string | null, enteredAt: string): RewardRecord => ({
    item: 'x', projectCode: '', payoutMethod: '', gross: 1, tax: 0, net: 1,
    status: paidAt ? 'paid' : 'pending', paidAt, enteredAt, submittedBy: '', payingUnit: '',
  });
  test('cuts by paid date, or entered date while pending (this week = Mon..today)', () => {
    const list = [rec('2026-10-12', '2026-10-09'), rec(null, '2026-10-21'), rec('2026-10-19', '2026-10-15')];
    expect(rewardsBetween(list, '2026-10-19', '2026-10-21').map((r) => r.paidAt ?? r.enteredAt)).toEqual(['2026-10-21', '2026-10-19']);
    expect(rewardTotals(rewardsBetween(list, '2026-10-19'))).toEqual({ gross: 2, tax: 0, net: 2 });
    expect(rewardTotals([])).toBeNull();
  });
});

