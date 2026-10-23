import type { HostServices } from '@pku-harness/sdk';

import { cardAccount } from '../../../shared/campus-card';

/**
 * 校园卡充值 (pkucli crates/campuscard/src/api.rs create_recharge_order + sign_params, commands.rs
 * cmd_recharge). POST /charge/order/thirdOrder with the card JWT *in the form* and a SHA-256
 * signature over every field; the answer is a 3xx whose Location is the 收银台 (cashier) page with
 * the order id and a token. The user picks WeChat Pay / Alipay there and pays in that app; this
 * code never pays and never hands the cashier URL to the model.
 */

/** Amounts the official 收银台 offers (commands.rs cmd_recharge). */
export const RECHARGE_PRESETS = [10, 50, 100, 200, 500, 800] as const;
export const RECHARGE_MAX = 1000;

// api.rs sign_params: the PKU app's signing credentials (public in the app and in pkucli).
const APP_ID = '56321';
const SECRET = '0osTIhce7uPvDKHz6aa67bhCukaKoYl4';

/** yyyyMMddHHmmss in Beijing time (api.rs timestamp_now runs on a CST machine). */
export function beijingTimestamp(now = Date.now()) {
  const d = new Date(now + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** 11 chars of [0-9a-z] (api.rs nonce). */
export function nonce(random = Math.random) {
  const abc = '0123456789abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: 11 }, () => abc[Math.floor(random() * abc.length)]).join('');
}

/** The string sign_params hashes: sorted non-empty `k=v&` pairs (minus SIGN), then SECRET_KEY. */
export function signingString(fields: Record<string, string>) {
  const pairs = Object.keys(fields)
    .filter((k) => k !== 'SIGN' && k !== 'SECRET_KEY' && fields[k] !== '')
    .sort()
    .map((k) => `${k}=${fields[k]}&`);
  return `${pairs.join('')}SECRET_KEY=${SECRET}`;
}

/** api.rs sign_params: add APP_ID / TIMESTAMP / SIGN_TYPE / NONCE, then SIGN = SHA256(…) upper hex. */
export async function signFields(fields: Record<string, string>, sha256: (s: string) => Promise<string>, now = Date.now()) {
  const all = { ...fields, APP_ID, TIMESTAMP: beijingTimestamp(now), SIGN_TYPE: 'SHA256', NONCE: nonce() };
  return { ...all, SIGN: (await sha256(signingString(all))).toUpperCase() };
}

type Services = Pick<HostServices, 'campus' | 'crypto'>;

/** Create a recharge order; returns the cashier URL (keep it away from tool results). */
export async function createRechargeOrder(services: Services, amountYuan: number) {
  const account = await cardAccount(services);
  const res = await services.campus.request('card', {
    url: '/charge/order/thirdOrder',
    method: 'POST',
    followRedirects: false,
    authIn: 'form', // the host adds `synjones-auth: bearer <jwt>` before signing
    form: {
      feeitemid: '401',
      appid: APP_ID,
      tranamt: String(amountYuan),
      source: 'app',
      yktcard: account,
      synAccessSource: 'h5',
      abstracts: JSON.stringify({ type: 'recharge' }),
    },
    sign: (fields) => signFields(fields, services.crypto.sha256),
  });
  const location = res.headers.location ?? res.headers.Location;
  if (res.status < 300 || res.status >= 400 || !location) {
    throw new Error(`创建充值订单失败（HTTP ${res.status}${res.body ? `：${res.body.slice(0, 80)}` : ''}）`);
  }
  if (!/^https:\/\//i.test(location)) throw new Error('充值订单返回的收银台地址无效');
  return location;
}
