import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

import { INCOME_ICONS, unwrap, yuan, type CardInfo, type Turnover } from './api';

/** Campus card: balance and transactions (pkucli crates/campuscard). Read-only for now. */
export const campusCardPlugin = definePlugin({
  id: 'campus-card',
  name: '校园卡',
  description: '查询校园卡余额和消费记录。',
  version: '0.1.0',
  icon: 'card',
  requires: ['campus-session', 'network'],
  scopes: ['bdcard.pku.edu.cn', 'portal.pku.edu.cn（登录）'],
  instructions: '校园卡金额单位是元。用户问余额用 campus-card__getBalance；问最近花了多少、在哪消费用 campus-card__listTransactions。',
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
