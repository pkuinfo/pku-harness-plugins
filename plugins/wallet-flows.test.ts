/**
 * The wallet document's side that recorded tests (tests/*.yaml) can't show: the signed top-up form
 * and the cashier going only to the browser, the payment platform opened signed in, the request
 * bodies, the ids taken over from campus-card / netfee / utilities (was legacy.test.ts), and the
 * payment-code screen's safety settings.
 */
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compilePlugin, loadDocument } from '../packages/sdk/src';
import { runTool } from '../packages/sdk/src/lang/run';
import { replayEnv, type Recorded } from '../packages/sdk/src/lang/testing';

const dir = join(import.meta.dir, 'wallet');
const doc = await loadDocument(async (p) => readFileSync(join(dir, p), 'utf8'));
const fixture = (f: string) => readFileSync(join(dir, 'tests', f), 'utf8');
const NOW = Date.parse('2026-10-19T21:30:00+08:00'); // 13:30 UTC
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ok = (data: unknown) => JSON.stringify({ code: 200, success: true, data });
const CASHIER = 'https://pay.example.edu.cn/cashier?orderid=9&token=secret';

function env(responses: Recorded[]) {
  const opened: string[] = [];
  const signedIn: string[] = [];
  const r = replayEnv(doc, responses, {
    now: NOW,
    services: {
      browser: { open: async (url: string) => (opened.push(url), { opened: true as const }) },
      campus: { openSignedIn: async (s: string) => (signedIn.push(s), { opened: true as const }) },
    } as never,
  });
  return { ...r, opened, signedIn };
}

/** pkucli api.rs sign_params: sorted non-empty `k=v&` pairs (minus SIGN), then SECRET_KEY. */
const signingString = (fields: Record<string, string>) =>
  `${Object.keys(fields)
    .filter((k) => k !== 'SIGN' && k !== 'SECRET_KEY' && fields[k] !== '')
    .sort()
    .map((k) => `${k}=${fields[k]}&`)
    .join('')}SECRET_KEY=0osTIhce7uPvDKHz6aa67bhCukaKoYl4`;

describe('wallet: cardRecharge', () => {
  const responses: Recorded[] = [
    { match: 'ykt/tsm/queryCard', campus: 'card', text: ok({ card: [{ account: '123456', lostflag: 0, freezeflag: 0, elec_accamt: 1 }] }) },
    { match: '/charge/order/thirdOrder', campus: 'card', status: 302, headers: { location: CASHIER }, text: '' },
  ];

  test('signed form with the token the host added; the cashier goes to the browser only', async () => {
    const r = env(responses);
    const out = await runTool(r.env, 'cardRecharge', { amount: 100 });
    expect(out).toEqual({ amount: 100, cashierOpened: true, next: '用户在收银台选择微信或支付宝并在该 App 内付款；付款后需在 POS 机刷一次卡才到账' });
    expect(JSON.stringify(out)).not.toContain('token');
    expect(r.opened).toEqual([CASHIER]);
    const req = r.seen[1]!;
    expect([req.url, req.method]).toEqual(['/charge/order/thirdOrder', 'POST']);
    const { NONCE, SIGN, ...rest } = req.form!;
    expect(rest).toEqual({
      feeitemid: '401',
      appid: '56321',
      tranamt: '100',
      source: 'app',
      yktcard: '123456',
      synAccessSource: 'h5',
      abstracts: '{"type":"recharge"}',
      APP_ID: '56321',
      TIMESTAMP: '20261019213000', // Beijing time, whatever the device zone
      SIGN_TYPE: 'SHA256',
      'synjones-auth': 'bearer test-token',
    });
    expect(NONCE).toMatch(/^[0-9a-z]{11}$/);
    expect(SIGN).toBe(sha256(signingString(req.form!)).toUpperCase());
    expect(signingString(req.form!)).toStartWith('APP_ID=56321&NONCE=');
  });

  test('the same fields sign the same as pkucli (fixed NONCE, card/recharge.test.ts vector)', () => {
    const fixed = {
      feeitemid: '401', appid: '56321', tranamt: '100', source: 'app', yktcard: '123456', synAccessSource: 'h5',
      abstracts: JSON.stringify({ type: 'recharge' }), 'synjones-auth': 'bearer x.y.z', empty: '',
      APP_ID: '56321', TIMESTAMP: '20261019213000', SIGN_TYPE: 'SHA256', NONCE: 'abc',
    };
    expect(sha256(signingString(fixed)).toUpperCase()).toBe('EE0D2A1CBE422DC32665D8FACC1F71F73F9864258C285536D9E289AC85A9EC75');
  });

  test('the 充值 screen’s tap goes through cardRecharge with the typed whole yuan', async () => {
    const r = env(responses);
    await runTool(r.env, 'cardTopUp', { preset: 100, custom: '¥ 88' });
    expect(r.seen[1]!.form!.tranamt).toBe('88');
    expect(r.opened).toEqual([CASHIER]);
  });
});

describe('wallet: payment platform', () => {
  const projects: Recorded[] = [
    { match: 'getProjectTypeAndProjectInfoListInit/10001', campus: 'cwpay', text: fixture('cwpay-projects.json') },
    { match: 'getProjectTypeAndProjectInfoList/f-more', campus: 'cwpay', text: JSON.stringify({ messageCode: '0', data: [] }) },
  ];

  test('bathRecharge creates the order and opens the platform signed in; no URL in the result', async () => {
    const r = env([
      ...projects,
      { match: 'getProjectIsAllowPayment', campus: 'cwpay', text: JSON.stringify({ messageCode: '0', data: true }) },
      { match: 'bath/createOrder', campus: 'cwpay', text: fixture('cwpay-bath-order.json') },
    ]);
    const out = await runTool(r.env, 'bathRecharge', { amount: 20.5 });
    expect(out).toEqual({ amount: 20.5, orderCreated: true, platformOpened: true, next: '在收费平台「我的订单」里找到这笔待支付的浴卡订单，用微信或支付宝付款；付款后拿浴卡到浴卡转存机贴卡激活才到账' });
    expect(r.signedIn).toEqual(['cwpay']);
    expect(r.seen.map((s) => [s.url, s.method, s.body ?? null])).toEqual([
      ['pay/pay/cos/merchant/getProjectTypeAndProjectInfoListInit/10001', 'GET', null],
      ['pay/pay/cos/merchant/getProjectTypeAndProjectInfoList/f-more', 'GET', null],
      ['pay/project/getProjectIsAllowPayment', 'POST', '{"projectId":"p-bath"}'],
      ['pay/web/bath/createOrder', 'POST', '{"schoolCode":"10001","projectId":"p-bath","payamtStr":20.5}'],
    ]);
  });

  test('bathCard asks 我的订单 for the bath project’s orders', async () => {
    const r = env([...projects, { match: 'queryBathFeeInfo', campus: 'cwpay', text: fixture('cwpay-bath-info.json') }, { match: 'pageOrderlist', campus: 'cwpay', text: fixture('cwpay-orders.json') }]);
    await runTool(r.env, 'bathCard', {});
    expect(r.seen[2]!.url).toBe('pay/web/bath/queryBathFeeInfo/2000000000/p-bath');
    expect(JSON.parse(r.seen[3]!.body!)).toEqual({ pageCurrent: 1, pageSize: 20, projectName: '', projectId: 'p-bath', displayStatus: '', startCreateDate: '', endCreateDate: '', schoolCode: '10001' });
  });

  test('openPayCenter opens the signed-in platform', async () => {
    const r = env([]);
    expect(await runTool(r.env, 'openPayCenter', {})).toEqual({ opened: true });
    expect(r.signedIn).toEqual(['cwpay']);
  });

  test('cardSetDigital posts 数字卡', async () => {
    const r = env([
      { match: 'useCard/getUseCardConfig', campus: 'card', text: ok({ cardType: '0', cardTypes: [{ name: '实体卡', code: 0 }, { name: '数字卡', code: 1 }] }) },
      { match: 'useCard/setUseCardConfig', campus: 'card', text: JSON.stringify({ code: 200, success: true, data: null }) },
    ]);
    expect(await runTool(r.env, 'cardSetDigital', {})).toEqual({ changed: true, from: '实体卡', mode: '数字卡' });
    expect([r.seen[1]!.method, r.seen[1]!.body]).toEqual(['POST', '{"cardType":1,"synAccessSource":"h5"}']);
  });

  test('cardSetMode posts the chosen code, and never posts an unknown or unchanged mode', async () => {
    const cfg = { match: 'useCard/getUseCardConfig', campus: 'card', text: ok({ cardType: '1', cardTypes: [{ name: '实体卡', code: 0 }, { name: '数字卡', code: 1 }, { name: 'NFC卡', code: 2 }] }) };
    const set = { match: 'useCard/setUseCardConfig', campus: 'card', text: JSON.stringify({ code: 200, success: true, data: null }) };
    const r = env([cfg, set]);
    expect(await runTool(r.env, 'cardSetMode', { mode: 'NFC卡' })).toEqual({ changed: true, from: '数字卡', mode: 'NFC卡' });
    expect([r.seen[1]!.method, r.seen[1]!.body]).toEqual(['POST', '{"cardType":2,"synAccessSource":"h5"}']);
    for (const mode of ['手环', '数字卡']) {
      const q = env([cfg, set]);
      await runTool(q.env, 'cardSetMode', { mode }).catch(() => null);
      expect(q.seen.map((s) => s.method ?? 'GET')).toEqual(['GET']);
    }
  });
});

/** The wallet replaced campus-card, netfee and utilities: every id users may have stored must map to something. */
describe('wallet: legacy ids', () => {
  const plugin = compilePlugin(doc, { verified: true, fetch: async () => { throw new Error('no public HTTP'); } });
  const legacy = plugin.legacy!;
  const OLD_TOOLS = [
    'campus-card.getBalance', 'campus-card.setDigitalCard', 'campus-card.recharge', 'campus-card.getMonthlyStats', 'campus-card.listTransactions',
    'netfee.getStatus', 'utilities.bathCard', 'utilities.rechargeBath', 'utilities.payProjects', 'utilities.openPayCenter',
  ];
  test('replaces the three plugins', () => {
    expect(legacy.pluginIds).toEqual(['campus-card', 'netfee', 'utilities']);
  });
  test('every old tool maps to a wallet tool, with its effect', () => {
    expect(Object.keys(legacy.tools ?? {}).sort()).toEqual([...OLD_TOOLS].sort());
    const effects: Record<string, string> = { 'campus-card.setDigitalCard': 'write', 'campus-card.recharge': 'money', 'utilities.rechargeBath': 'money', 'utilities.openPayCenter': 'write' };
    for (const [old, name] of Object.entries(legacy.tools ?? {})) {
      expect(plugin.tools[name]).toBeDefined();
      expect([old, plugin.tools[name]!.effect]).toEqual([old, (effects[old] ?? 'read') as never]);
    }
  });
  test('every old widget maps to a wallet widget', () => {
    expect(Object.keys(legacy.widgets ?? {}).sort()).toEqual(['campus-card.balance', 'netfee.balance', 'utilities.bath']);
    for (const key of Object.values(legacy.widgets ?? {})) expect(plugin.contributes?.widgets?.[key]).toBeDefined();
  });
  test('old screen routes (/m/campus-card/pay, /m/utilities/bath-recharge) still find their screen', () => {
    for (const key of ['pay', 'recharge', 'bath-recharge']) {
      expect(plugin.contributes?.screens?.[key]).toBeDefined();
      expect(plugin.contributes?.screens?.[key]?.presentation).toBe('modal');
    }
  });
  test('only a verified copy takes the old ids over', () => {
    expect(compilePlugin(doc, { verified: false, fetch: async () => { throw new Error('x'); } }).legacy).toBeUndefined();
  });
});

describe('wallet: payment code stays away from the agent', () => {
  test('the screen is secure and its code is a live, memory-only binding of a tap-only tool', () => {
    const pay = doc.screens.pay!;
    expect(pay.secure).toEqual({ brightness: true });
    expect(pay.bindings?.['/pay']).toEqual({ tool: 'payCode', refreshSeconds: 30 });
    const qrs = Object.values(pay.spec.elements as Record<string, { type: string; props: { value?: unknown } }>).filter((e) => e.type === 'QRCode');
    expect(qrs.map((e) => e.props.value)).toEqual([{ $state: '/pay/code' }, { $state: '/result/pay/code' }]);
    expect(doc.tools.payCode!.userOnly).toBe(true);
    for (const t of ['cardTopUp', 'bathTopUp', 'overview']) expect(doc.tools[t]!.userOnly).toBe(true);
  });
  test('sharing opens the card-share plugin’s create screen', () => {
    const share = (doc.screens.pay!.spec.elements as Record<string, { on?: { press?: { params?: { href?: string } } } }>).share!;
    expect(share.on?.press?.params?.href).toBe('/m/card-share/create');
  });
});
