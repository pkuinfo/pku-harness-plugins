import { defineTool, type ToolDef } from '@pku-harness/sdk';
import { z } from 'zod';

import { parseBilling, parseItsInfo, toNumber } from './parse';

/** Network fee (its.pku.edu.cn) balance and usage (pkucli crates/portal/src/netfee.rs). */
export const netfeeTools: Record<string, ToolDef> = {
  netfeeBalance: defineTool({
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
};
