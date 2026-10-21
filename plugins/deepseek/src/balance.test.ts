/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { fetchBalance, parseBalance } from './balance';

describe('DeepSeek balance', () => {
  test('parses string amounts into numbers', () => {
    expect(
      parseBalance({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
      }),
    ).toEqual({ available: true, balances: [{ currency: 'CNY', total: 110, granted: 10, toppedUp: 100 }] });
  });

  test('keeps an empty, unavailable account', () => {
    expect(parseBalance({ is_available: false, balance_infos: [] })).toEqual({ available: false, balances: [] });
  });

  test('rejects malformed bodies', () => {
    expect(() => parseBalance({ balance_infos: [] })).toThrow('余额响应格式无法识别');
    expect(() => parseBalance({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 'abc' }] })).toThrow();
  });

  test('calls /user/balance with the bearer key', async () => {
    let seen: { url: string; auth?: string } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      seen = { url, auth: (init?.headers as Record<string, string>).Authorization };
      return new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '1.5' }] }));
    }) as unknown as typeof fetch;
    const account = await fetchBalance({ baseURL: 'https://api.deepseek.com/', model: 'x', credential: 'sk-test', fetch: fake });
    expect(seen!).toEqual({ url: 'https://api.deepseek.com/user/balance', auth: 'Bearer sk-test' });
    expect(account.balances[0]).toEqual({ currency: 'USD', total: 1.5, granted: undefined, toppedUp: undefined });
  });

  test('maps 401 to a short message', async () => {
    const fake = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchBalance({ baseURL: 'https://x', model: 'x', credential: 'k', fetch: fake })).rejects.toThrow('API Key 无效');
  });
});
