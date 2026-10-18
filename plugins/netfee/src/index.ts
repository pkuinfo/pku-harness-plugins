import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

import { parseBilling, parseItsInfo, toNumber } from './parse';

/** Network fee (its.pku.edu.cn) balance and usage (pkucli crates/portal/src/netfee.rs). */
export const netfeePlugin = definePlugin({
  id: 'netfee',
  name: '网费',
  description: '查询校园网账户余额和本月用量。',
  version: '0.1.0',
  icon: 'wifi',
  requires: ['campus-session', 'network'],
  scopes: ['its.pku.edu.cn'],
  instructions: '网费余额单位是元。用户问网费、上网余额时用 netfee__getStatus。',
  dataSources: {
    balance: { title: '网费余额', tool: 'getStatus', ttlMs: 30 * 60_000 },
  },
  tools: {
    getStatus: defineTool({
      title: '查询网费',
      description: 'Campus network account balance (yuan), this month\'s usage and fee.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => {
        const res = await ctx.services.campus.request('its', {
          url: '/netportal/itsUtil?operation=info',
          headers: { 'x-requested-with': 'XMLHttpRequest' },
        });
        const pairs = parseItsInfo(res.body);
        const billing = parseBilling(res.body);
        const balance = toNumber(pairs['余额'] ?? billing.balance);
        if (balance == null && !Object.keys(pairs).length) throw new Error('没能读到网费信息，页面结构可能变了');
        return {
          balance,
          monthlyUsage: pairs['本月使用'] ?? pairs['本月流量'] ?? billing.monthlyUsage,
          monthlyFee: toNumber(pairs['本月费用'] ?? pairs['月费用'] ?? billing.monthlyFee),
          fields: pairs,
        };
      },
    }),
  },
});
