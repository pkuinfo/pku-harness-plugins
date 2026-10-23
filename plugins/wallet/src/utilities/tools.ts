import { defineTool, type ToolDef } from '@pku-harness/sdk';
import { z } from 'zod';

import { bathCard, createBathOrder, listProjects, openPayCenter } from './api';
import { BATH_MAX, BATH_MIN, checkBathAmount, PROJECT_KINDS } from './parse';

/**
 * 水电浴 (dorm utilities). What PKU exposes today (2026-10-21):
 * - 浴卡 (bath card): 北京大学收费平台 cwpay.pku.edu.cn (card info, top-up orders, recharge);
 *   the balance lives on the card chip and has no online query.
 * - 宿舍电费: 动力中心's WeChat service account only; no web API (see ELECTRICITY_GUIDE).
 * - Campus card (bdcard, synjones) has no utility payment items for PKU.
 */
export const utilityTools: Record<string, ToolDef> = {
  bathCard: defineTool({
    title: '浴卡信息',
    description:
      'Bath card (浴卡) on the PKU payment platform: masked card number, holder name, and the latest bath-card top-ups (amount in yuan, time, status 待支付/已付款). available: false means the platform doesn\'t offer bath top-ups to this account right now (say so plainly; not an error, retrying won\'t help). The card balance is stored on the card chip and cannot be read online.',
    input: z.object({}),
    effect: 'read',
    execute: async (_input, ctx) => {
      const r = await bathCard(ctx.services);
      return { ...r, balance: null, balanceNote: '浴卡余额在卡片芯片里，线上查不到；在浴卡转存机或洗浴时可看到。' };
    },
  }),
  bathRecharge: defineTool({
    title: '浴卡充值',
    description: `Top up the bath card: creates a ${BATH_MIN}–${BATH_MAX} yuan bath-card order on the PKU payment platform and opens the platform (signed in) in the system browser, where the user pays the pending order with WeChat Pay or Alipay. Does not pay and cannot confirm payment. After paying, the user must tap the card on a 浴卡转存机 to load the money.`,
    input: z.object({ amount: z.number().min(BATH_MIN).max(BATH_MAX).describe(`yuan, ${BATH_MIN}–${BATH_MAX}, at most 2 decimals`) }),
    effect: 'money',
    execute: async ({ amount }, ctx) => {
      const bad = checkBathAmount(amount);
      if (bad) throw new Error(bad);
      await createBathOrder(ctx.services, amount);
      await openPayCenter(ctx.services);
      // The hand-off URL carries the platform session token: never part of the result.
      return { amount, orderCreated: true, platformOpened: true, next: '在收费平台「我的订单」里找到这笔待支付的浴卡订单，用微信或支付宝付款；付款后拿浴卡到浴卡转存机贴卡激活才到账' };
    },
  }),
  payProjects: defineTool({
    title: '收费平台缴费项目',
    description: 'Payment items currently open on the PKU payment platform (收费平台 cwpay.pku.edu.cn): name, category and kind (tuition, bath card, network fee, campus card, …). Use to answer "what can I pay online".',
    input: z.object({}),
    effect: 'read',
    execute: async (_input, ctx) => {
      const projects = await listProjects(ctx.services);
      return { count: projects.length, projects: projects.map((p) => ({ name: p.name, category: p.category, kind: PROJECT_KINDS[p.kind] ?? p.kind ?? null })) };
    },
  }),
  openPayCenter: defineTool({
    title: '打开收费平台',
    description: 'Open the PKU payment platform (收费平台), already signed in, in the system browser so the user can pay tuition, pending orders or other fees themselves. Hands the platform session to the browser; nothing is paid by this tool.',
    input: z.object({}),
    effect: 'write',
    execute: async (_input, ctx) => {
      await openPayCenter(ctx.services);
      return { opened: true };
    },
  }),
};
