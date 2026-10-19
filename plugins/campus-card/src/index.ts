import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

import { BalanceWidget } from './widget';

import { cardMode, INCOME_ICONS, setDigitalCard, unwrap, yuan, type CardInfo, type Turnover } from './api';
import { PayScreen } from './pay';

/** Campus card: balance and transactions (pkucli crates/campuscard). Read-only for now. */
export const campusCardPlugin = definePlugin({
  id: 'campus-card',
  name: '校园卡',
  description: '查询校园卡余额和消费记录。',
  version: '0.2.0',
  icon: 'card',
  requires: ['campus-session', 'network'],
  scopes: ['bdcard.pku.edu.cn', 'portal.pku.edu.cn（登录）'],
  contributes: {
    screens: { pay: { title: '付款码', component: PayScreen, presentation: 'modal' } },
    settings: [{ screen: 'pay', title: '校园卡付款码', subtitle: '食堂、超市扫码付款', icon: 'qr' }],
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
  },
  instructions: '校园卡金额单位是元。用户问余额用 campus-card__getBalance；问最近花了多少、在哪消费用 campus-card__listTransactions。付款码不经过你：让用户点看板校园卡组件上的「付款码」，或在 设置 →「校园卡付款码」打开。',
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
