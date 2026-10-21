import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

import { BalanceWidget } from './widget';

import { cardMode, INCOME_ICONS, setDigitalCard, unwrap, yuan, type CardInfo, type Turnover } from './api';
import { PayScreen } from './pay';
import { createRechargeOrder, RECHARGE_MAX } from './recharge';
import { RechargeScreen } from './recharge-screen';
import { currentMonth, monthRange, statsUrls, summarizeMonth, type DailyStats, type TurnoverCategory, type TurnoverCount } from './stats';

/** Campus card: balance, transactions, monthly statistics, payment code (pkucli crates/campuscard). */
export const campusCardPlugin = definePlugin({
  id: 'campus-card',
  name: '校园卡',
  description: '查询校园卡余额、消费记录和月度消费统计。',
  version: '0.4.0',
  icon: 'card',
  requires: ['campus-session', 'network'],
  scopes: ['bdcard.pku.edu.cn', 'portal.pku.edu.cn（登录）'],
  contributes: {
    screens: {
      pay: { title: '付款码', component: PayScreen, presentation: 'modal' },
      recharge: { title: '充值', component: RechargeScreen, presentation: 'modal' },
    },
    settings: [
      { screen: 'pay', title: '校园卡付款码', subtitle: '食堂、超市扫码付款', icon: 'qr' },
      { screen: 'recharge', title: '校园卡充值', subtitle: '微信 / 支付宝付款', icon: 'card' },
    ],
    widgets: {
      balance: {
        title: '校园卡余额',
        description: '校园卡余额、今日消费和卡状态，余额偏低时变色提醒（默认低于 50 元）。',
        sizes: ['sm', 'md', 'lg'],
        defaultSize: 'md',
        configSchema: z.object({ warnBelow: z.number().min(0).optional().describe('highlight below this balance, yuan') }),
        component: BalanceWidget,
      },
    },
    commands: {
      balance: { description: '查校园卡余额', aliases: ['余额'], prompt: '校园卡还剩多少钱？' },
    },
  },
  instructions: '校园卡金额单位是元。用户问余额用 campus-card__getBalance；问最近花了多少、在哪消费用 campus-card__listTransactions；问某个月一共花了多少、钱主要花在哪类（餐费、超市等）、哪天花得最多，用 campus-card__getMonthlyStats（一次返回整月汇总，比翻流水省事）。用户要充值时用 campus-card__recharge（金额单位元，整数）：它创建学校的充值订单并在系统浏览器打开收银台，用户在里面选微信或支付宝、在那个 App 里自己付款；你不能也不需要代付，收银台链接也不会给你。调用后告诉用户去收银台完成付款，付完后在 POS 机上刷一次卡才能到账，之后可以再查余额确认。付款码不经过你：让用户点看板校园卡组件上的「付款码」，或在 设置 →「校园卡付款码」打开。',
  dataSources: {
    balance: { title: '校园卡余额', tool: 'getBalance', ttlMs: 5 * 60_000 },
  },
  tools: {
    getBalance: defineTool({
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
    setDigitalCard: defineTool({
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
    recharge: defineTool({
      title: '校园卡充值',
      description: 'Top up the campus card: creates the school\'s recharge order for `amount` yuan and opens its cashier page in the system browser, where the user picks WeChat Pay or Alipay and pays in that app. Does not pay and cannot confirm payment; check getBalance later (the money shows after one tap on a canteen POS).',
      input: z.object({ amount: z.number().int().min(1).max(RECHARGE_MAX).describe('yuan, whole number; the cashier suggests 10 / 50 / 100 / 200 / 500 / 800') }),
      effect: 'money',
      execute: async ({ amount }, ctx) => {
        const cashier = await createRechargeOrder(ctx.services, amount);
        await ctx.services.browser.open(cashier);
        // The cashier URL carries an order token: never part of the result (it reaches the model).
        return { amount, cashierOpened: true, next: '用户在收银台选择微信或支付宝并在该 App 内付款；付款后需在 POS 机刷一次卡才到账' };
      },
    }),
    getMonthlyStats: defineTool({
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
    listTransactions: defineTool({
      title: '查询消费记录',
      description: 'Recent card transactions, newest first. Amounts in yuan; negative = spending.',
      input: z.object({
        limit: z.number().int().min(1).max(50).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      effect: 'read',
      execute: async ({ limit, from, to }, ctx) => {
        const q = [`size=${limit ?? 20}`, 'current=1', 'synAccessSource=h5', from ? `timeFrom=${from}` : '', to ? `timeTo=${to}` : ''].filter(Boolean).join('&');
        const page = unwrap<{ records: Turnover[]; total: number }>(await ctx.services.campus.request('card', { url: `/berserker-search/search/personal/turnover?${q}` }));
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
  },
});
