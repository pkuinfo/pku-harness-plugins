import { defineTool, type ToolContext } from '@pku-harness/sdk';
import { z } from 'zod';

import { DRAFT_KEY, MOCK_KEY, shareManager } from './manager';
import type { ShareRecord } from './session';
import { CAP_PRESETS, TTL_PRESETS, type TtlPreset } from './strings';

/** Prefill for the create sheet, written by `cardShare.start` (the agent never creates shares itself). */
export const draftSchema = z.object({
  ttl: z.enum(TTL_PRESETS).optional(),
  capYuan: z.number().min(1).max(1000).nullable().optional(),
  nameCheck: z.boolean().optional(),
  pin: z.boolean().optional(),
  at: z.number(),
});
export type Draft = z.infer<typeof draftSchema>;

export async function managerFor(ctx: Pick<ToolContext, 'kv' | 'services' | 'cloud'>) {
  const mock = (await ctx.kv.get<boolean>(MOCK_KEY)) ?? false;
  const m = shareManager({ kv: ctx.kv, services: ctx.services, cloud: ctx.cloud, mock });
  await m.load();
  return m;
}

/** What the agent may know about a share: no link, no code, no PIN, no name. */
export function describeShare(r: ShareRecord, now = Date.now()) {
  return {
    id: r.id,
    status: r.status,
    startedAt: new Date(r.createdAt).toISOString(),
    ...(r.status === 'active' ? { minutesLeft: Math.max(0, Math.round((r.expiresAt - now) / 60_000)) } : { endedAt: r.endedAt ? new Date(r.endedAt).toISOString() : null, endReason: r.endReason ?? null }),
    viewer: r.viewer ? (r.viewer.verified ? (r.viewer.online ? 'viewing' : 'left') : 'opened, not verified') : 'not opened yet',
    gates: [...(r.nameHint ? ['name'] : []), ...(r.pin ? ['pin'] : [])],
    failedChecks: r.failures,
    codesShown: r.codesIssued,
    spentYuan: r.spent,
    payments: r.payments.length,
    capYuan: r.capYuan,
  };
}

export const tools = {
  list: defineTool({
    title: '查看付款码共享',
    description:
      'List the user’s Campus Card payment-code shares (active first, then recent history): time left, whether the friend opened it, codes shown, money spent against the cap. Never includes the link or any code.',
    input: z.object({}),
    effect: 'read',
    execute: async (_input, ctx) => {
      const m = await managerFor(ctx);
      const now = Date.now();
      return { shares: m.list().map((r) => describeShare(r, now)) };
    },
  }),
  revoke: defineTool({
    title: '停止付款码共享',
    description: 'Stop a payment-code share now (the friend’s page shows it ended and no more codes are sent). Omit id to stop every active share.',
    input: z.object({ id: z.string().min(1).optional().describe('share id from cardShare.list') }),
    effect: 'write',
    execute: async ({ id }, ctx) => {
      const m = await managerFor(ctx);
      if (id) {
        if (!m.record(id)) throw new Error('没有这个分享');
        return { stopped: (await m.stop(id)) ? [id] : [] };
      }
      return { stopped: await m.stopAll() };
    },
  }),
  start: defineTool({
    title: '分享付款码',
    description:
      'Prepare a payment-code share for the user to confirm. You cannot create the share or see its link: this saves your suggested settings and the user finishes in the 分享付款码 sheet (付款码共享 in Settings, or 分享给朋友 on the payment-code screen), where they pick who gets the link. Returns {status:"awaiting_user"}.',
    input: z.object({
      ttl: z.enum(TTL_PRESETS).optional().describe('10m | 30m | 2h | today'),
      capYuan: z.number().min(1).max(1000).nullable().optional().describe(`spend cap in yuan (default 50; presets ${CAP_PRESETS.join('/')}); null = no cap`),
      nameCheck: z.boolean().optional().describe('ask the friend to complete the masked holder name'),
      pin: z.boolean().optional().describe('ask the user to set a PIN the friend must enter'),
    }),
    effect: 'money',
    execute: async (input, ctx) => {
      const draft: Draft = { ...input, ttl: input.ttl as TtlPreset | undefined, at: Date.now() };
      await ctx.kv.set(DRAFT_KEY, draft);
      return {
        status: 'awaiting_user',
        screen: '/m/card-share/create',
        message: 'Settings saved as a draft. Ask the user to open 设置 → 付款码共享 (or 分享给朋友 on the payment-code screen) to confirm and send the link themselves.',
      };
    },
  }),
};
