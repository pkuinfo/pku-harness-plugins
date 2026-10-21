import type { ModelPricing, ProviderAccount, ProviderConfig } from '@pku-harness/sdk';
import { z } from 'zod';

/** Source of the prices below (checked 2026-10-20). */
const PRICING_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing (2026-10-20)';

/**
 * Peak hours: Beijing time (UTC+8), Mon–Fri 9:00–12:00 and 14:00–18:00, prices ×2.
 * DeepSeek excludes Chinese public holidays from peak; we ignore holidays (slight overestimate).
 */
const PEAK: NonNullable<ModelPricing['peak']> = {
  multiplier: 2,
  utcOffsetMinutes: 8 * 60,
  weekdays: [1, 2, 3, 4, 5],
  hours: [
    [9, 12],
    [14, 18],
  ],
};

/** Published off-peak prices, CNY per 1M tokens. */
export const PRICING = {
  'deepseek-flash': { currency: 'CNY', inputCacheHit: 0.02, inputCacheMiss: 1, output: 4, peak: PEAK, source: PRICING_SOURCE },
  'deepseek-v4-pro': { currency: 'CNY', inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5, peak: PEAK, source: PRICING_SOURCE },
} satisfies Record<string, ModelPricing>;

const amount = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n), '金额格式错误');

const BalanceResponse = z.object({
  is_available: z.boolean(),
  balance_infos: z.array(
    z.object({
      currency: z.string(),
      total_balance: amount,
      granted_balance: amount.optional(),
      topped_up_balance: amount.optional(),
    }),
  ),
});

/** Parse a GET /user/balance body (amounts arrive as strings, e.g. "110.00"). */
export function parseBalance(body: unknown): ProviderAccount {
  const r = BalanceResponse.safeParse(body);
  if (!r.success) throw new Error('余额响应格式无法识别');
  return {
    available: r.data.is_available,
    balances: r.data.balance_infos.map((b) => ({
      currency: b.currency,
      total: b.total_balance,
      granted: b.granted_balance,
      toppedUp: b.topped_up_balance,
    })),
  };
}

/** GET {baseURL}/user/balance (https://api-docs.deepseek.com/api/get-user-balance). */
export async function fetchBalance(config: ProviderConfig): Promise<ProviderAccount> {
  if (!config.credential) throw new Error('未设置 API Key');
  const res = await config.fetch(`${config.baseURL.replace(/\/+$/, '')}/user/balance`, {
    headers: { Authorization: `Bearer ${config.credential}`, Accept: 'application/json' },
  });
  if (res.status === 401) throw new Error('API Key 无效');
  if (!res.ok) throw new Error(`余额查询失败：HTTP ${res.status}`);
  return parseBalance(await res.json());
}
