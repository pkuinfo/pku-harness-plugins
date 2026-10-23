/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { bathCardInfo, bathTopUps, checkBathAmount, createdOrderId, flattenProjects, isBathProject, maskId, unwrapCwpay, type RawOrder, type RawProject } from './parse';

const read = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();

describe('cwpay envelope', () => {
  test('live error answer throws its message', async () => {
    const body = await read('cwpay-error.json');
    expect(() => unwrapCwpay(body, '浴卡信息')).toThrow('收费平台：服务异常，请稍后再试（浴卡信息）');
  });
});

describe('bath project', () => {
  test('found by proModelUrl', async () => {
    const { projects } = flattenProjects(unwrapCwpay<RawProject[]>(await read('cwpay-projects.json'), 'p'));
    expect(projects.find(isBathProject)?.id).toBe('p-bath');
  });
  test('found by name when the kind differs', () => {
    expect(isBathProject({ id: '1', name: '学生浴卡充值', kind: 'common', category: '' })).toBe(true);
    expect(isBathProject({ id: '1', name: '网费', kind: 'net', category: '' })).toBe(false);
  });
});

describe('bath card', () => {
  test('masked card number, holder', async () => {
    expect(bathCardInfo(unwrapCwpay(await read('cwpay-bath-info.json'), 'b'))).toEqual({ cardNo: '2000****45', holder: '张三' });
    expect(bathCardInfo(null)).toEqual({ cardNo: null, holder: null });
  });
  test('order id', async () => {
    expect(createdOrderId(unwrapCwpay(await read('cwpay-bath-order.json'), 'o'))).toBe('ord-0001');
    expect(() => createdOrderId({})).toThrow('没有返回订单号');
  });
  test('top-ups filtered from orders', async () => {
    expect(bathTopUps(unwrapCwpay<{ records: RawOrder[] }>(await read('cwpay-orders.json'), 'o'))).toEqual([{ amount: 50, createdAt: '2026-10-20 08:12:00', status: '已付款' }]);
    expect(bathTopUps(null)).toEqual([]);
  });
});

describe('amount rules (浴卡充值 page)', () => {
  test.each([
    [9.99, '充值不能低于 10 元'],
    [100.01, '充值不能高于 100 元'],
    [10.005, '金额最多两位小数'],
    [Number.NaN, '请输入充值金额'],
  ])('%p → %s', (n, msg) => expect(checkBathAmount(n)).toBe(msg));
  test('valid', () => {
    for (const n of [10, 50, 99.5, 100]) expect(checkBathAmount(n)).toBeNull();
  });
});

describe('maskId', () => {
  test('lengths', () => {
    expect(maskId('2000012345')).toBe('2000****45');
    expect(maskId('123456')).toBe('12**56');
    expect(maskId('123')).toBe('***');
    expect(maskId('')).toBeNull();
  });
});
