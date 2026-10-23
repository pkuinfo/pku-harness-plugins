import { defineTool, type ToolDef } from '@pku-harness/sdk';
import { z } from 'zod';

import { cardMode, INCOME_ICONS, setDigitalCard, turnoverPage, unwrap, yuan, type CardInfo } from '@pku-harness/campus-card';
import { createRechargeOrder, RECHARGE_MAX } from './recharge';
import { currentMonth, monthRange, statsUrls, summarizeMonth, type DailyStats, type TurnoverCategory, type TurnoverCount } from './stats';

/** Campus card: balance, transactions, monthly statistics, payment code (pkucli crates/campuscard). */
export const cardTools: Record<string, ToolDef> = {
  cardBalance: defineTool({
    title: '查询校园卡余额',
    description: 'Campus card balance in yuan, plus card status (lost / frozen) and today\'s spending if available.',
    input: z.object({}),
    effect: 'read',
    execute: async (_input, ctx) => {
      const data = unwrap<{ card: CardInfo[] }>(await ctx.services.campus.request('card', { url: '/berserker-app/ykt/tsm/queryCard?synAccessSource=h5' }));
      const card = data.card[0];
      if (!card) throw new Error('没有找到校园卡');
      const acc = card.accinfo?.[0];
      return {
        balance: yuan(card.elec_accamt),
        name: card.name ?? null,
        status: card.lostflag ? 'lost' : card.freezeflag ? 'frozen' : 'normal',
        todaySpent: yuan(acc?.daycostamt),
        dailyLimit: yuan(acc?.daycostlimit),
        expires: card.expdate ?? null,
      };
    },
  }),
  cardSetDigital: defineTool({
    title: '切换到数字卡',
    description: 'Switch the card\'s 用卡方式 to 数字卡, which the payment code needs. Physical card / phone NFC may stop working until switched back. Only when the user asks.',
    input: z.object({}),
    effect: 'write',
    execute: async (_input, ctx) => {
      const before = await cardMode(ctx.services);
      if (before.digital) return { changed: false, mode: before.name };
      await setDigitalCard(ctx.services);
      return { changed: true, from: before.name, mode: '数字卡' };
    },
  }),
  cardRecharge: defineTool({
    title: '校园卡充值',
    description: 'Top up the campus card: creates the school\'s recharge order for `amount` yuan and opens its cashier page in the system browser, where the user picks WeChat Pay or Alipay and pays in that app. Does not pay and cannot confirm payment; check cardBalance later (the money shows after one tap on a canteen POS).',
    input: z.object({ amount: z.number().int().min(1).max(RECHARGE_MAX).describe('yuan, whole number; the cashier suggests 10 / 50 / 100 / 200 / 500 / 800') }),
    effect: 'money',
    execute: async ({ amount }, ctx) => {
      const cashier = await createRechargeOrder(ctx.services, amount);
      await ctx.services.browser.open(cashier);
      // The cashier URL carries an order token: never part of the result (it reaches the model).
      return { amount, cashierOpened: true, next: '用户在收银台选择微信或支付宝并在该 App 内付款；付款后需在 POS 机刷一次卡才到账' };
    },
  }),
  cardMonthlyStats: defineTool({
    title: '查询月度消费统计',
    description: 'One month of campus card statistics in yuan: total income (recharge, subsidy, refund) and spending, spending by category (sorted, with share), and per-day spending for days with any. Use for "how much did I spend in April", "where does my money go", monthly comparisons (call once per month).',
    input: z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM; default current month'),
    }),
    effect: 'read',
    execute: async ({ month }, ctx) => {
      const m = month ?? currentMonth();
      monthRange(m); // validate before any request
      const urls = statsUrls(m);
      const get = (url: string) => ctx.services.campus.request('card', { url });
      // commands.rs cmd_stats fetches the three in parallel.
      const [count, categories, daily] = await Promise.all([get(urls.count), get(urls.categories), get(urls.daily)]);
      return summarizeMonth(m, unwrap<TurnoverCount>(count), unwrap<TurnoverCategory[]>(categories), unwrap<DailyStats>(daily));
    },
  }),
  cardTransactions: defineTool({
    title: '查询消费记录',
    description: 'Recent card transactions, newest first. Amounts in yuan; negative = spending.',
    input: z.object({
      limit: z.number().int().min(1).max(50).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    effect: 'read',
    execute: async ({ limit, from, to }, ctx) => {
      const page = await turnoverPage(ctx.services, { size: limit ?? 20, from, to });
      return {
        total: page.total,
        items: page.records.map((t) => ({
          title: t.resume ?? '未知交易',
          type: t.icon ?? t.turnoverType ?? null,
          amount: (INCOME_ICONS.has(t.icon ?? '') ? 1 : -1) * (yuan(t.tranamt) ?? 0),
          balanceAfter: yuan(t.cardBalance),
          time: t.effectdateStr ?? null,
        })),
      };
    },
  }),
};
