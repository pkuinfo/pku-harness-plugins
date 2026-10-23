import type { CampusResponse, HostServices } from '@pku-harness/sdk';

/**
 * Campus card (bdcard.pku.edu.cn) response handling, ported from pkucli
 * crates/campuscard/src/api.rs. Amounts are in fen; every call carries synAccessSource=h5.
 */

type ApiResp<T> = { code: number; success?: boolean; data?: T; msg?: string; message?: string };

export function unwrap<T>(res: CampusResponse): T {
  let json: ApiResp<T>;
  try {
    json = JSON.parse(res.body) as ApiResp<T>;
  } catch {
    throw new Error(`校园卡服务返回了无法识别的内容（HTTP ${res.status}）`);
  }
  if (json.code === 401) throw new Error(`校园卡登录已失效：${json.message ?? json.msg ?? ''}`);
  if (!json.success || json.code !== 200 || json.data == null) throw new Error(`校园卡接口错误：${json.message ?? json.msg ?? '未知错误'}`);
  return json.data;
}

export const yuan = (fen: number | null | undefined) => (fen == null ? null : Math.round(fen) / 100);

export type CardInfo = {
  sno?: string;
  name?: string;
  account?: string;
  lostflag: number;
  freezeflag: number;
  expdate?: string;
  elec_accamt: number;
  accinfo?: { balance: number; name?: string; type?: string; daycostamt?: number; daycostlimit?: number }[];
};

export type Turnover = {
  resume?: string;
  turnoverType?: string;
  tranamt: number;
  cardBalance: number;
  effectdateStr?: string;
  icon?: string;
};

export const INCOME_ICONS = new Set(['recharge', 'subsidy', 'refund']);

// ── Payment code (pkucli crates/campuscard/src/commands.rs `paycode`) ─────────────────────────

type Services = Pick<HostServices, 'campus'>;
const get = (services: Services, url: string) => services.campus.request('card', { url });

/** 用卡方式 code for 数字卡; the payment code only works with it (api.rs CARD_TYPE_DIGITAL). */
export const CARD_TYPE_DIGITAL = 1;

export type UseCardConfig = { cardType: string; cardTypes: { name: string; code: number }[] };

export async function cardAccount(services: Services) {
  const data = unwrap<{ card: CardInfo[] }>(await get(services, '/berserker-app/ykt/tsm/queryCard?synAccessSource=h5'));
  const account = data.card[0]?.account;
  if (!account) throw new Error('校园卡缺少账户信息');
  return account;
}

export async function cardMode(services: Services) {
  const c = unwrap<UseCardConfig>(await get(services, '/berserker-app/useCard/getUseCardConfig?synAccessSource=h5'));
  const code = Number(c.cardType);
  return { code, name: c.cardTypes.find((t) => t.code === code)?.name ?? '未知', digital: code === CARD_TYPE_DIGITAL };
}

/** Why switching may conflict (NFC vs digital), as plain text; null when there is no notice. */
export async function conflictNotice(services: Services, account: string) {
  const r = unwrap<{ message?: string; status?: string }>(
    await get(services, `/berserker-app/cardConflict/getConflictInfo?fromaccount=${encodeURIComponent(account)}&flag=1&synAccessSource=h5`),
  );
  if (r.status !== '0' || !r.message) return null;
  return r.message
    .replace(/<!DOCTYPE[^>]*>|<[^>]+>/g, '')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .trim();
}

export async function setDigitalCard(services: Services) {
  const res = await services.campus.request('card', {
    url: '/berserker-app/useCard/setUseCardConfig',
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({ cardType: CARD_TYPE_DIGITAL, synAccessSource: 'h5' }),
  });
  // api.rs set_use_card_config: success && code 200; data may be null here.
  let json: ApiResp<unknown> | null = null;
  try {
    json = JSON.parse(res.body) as ApiResp<unknown>;
  } catch {
    // handled below
  }
  if (!json?.success || json.code !== 200) throw new Error(`切换用卡方式失败：${json?.msg ?? json?.message ?? `HTTP ${res.status}`}`);
}

/** The code shown to the POS (QR content) plus the balance it pays from. */
export async function paymentCode(services: Services, account: string) {
  const infos = unwrap<{ name: string; elec_accamt: number; payacc?: string; paytype?: string }[]>(await get(services, '/berserker-app/ykt/tsm/codebarPayinfo?synAccessSource=h5'));
  const info = infos[0];
  if (!info) throw new Error('未获取到付款信息');
  const q = `account=${encodeURIComponent(account)}&payacc=${info.payacc ?? '001'}&paytype=${info.paytype ?? '1'}&synAccessSource=h5`;
  const codes = unwrap<{ barcode: string[] }>(await get(services, `/berserker-app/ykt/tsm/batchGetBarCodeGet?${q}`));
  const code = codes.barcode[0];
  if (!code) throw new Error('未获取到付款码');
  return { code, name: info.name, balance: yuan(info.elec_accamt) };
}
