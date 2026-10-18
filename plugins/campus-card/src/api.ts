import type { CampusResponse } from '@pku-harness/sdk';

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
