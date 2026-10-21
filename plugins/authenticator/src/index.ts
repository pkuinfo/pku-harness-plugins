import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

import { AuthenticatorScreen } from './screen';
import { CodeWidget } from './widget';

/**
 * IAAA 手机令牌 (TOTP) held by the harness (src/core/campus/otp.ts, ported from pkucli
 * crates/common/src/otp.rs + treehole `otp bind --send / --verify`). Binding, the code and
 * removal go through `services.campus.otp*`; the secret never reaches this plugin, its tools or
 * the model. The harness itself fills IAAA 手机令牌 prompts, and course-sync / grades redeem
 * treehole's course token (40077) with the code.
 */
export const authenticatorPlugin = definePlugin({
  id: 'authenticator',
  name: '手机令牌',
  description: '把本 App 绑定为统一身份认证的手机令牌，自动完成二次验证。',
  version: '0.1.0',
  i18n: {
    en: {
      name: 'Authenticator',
      description: 'Makes this app your IAAA mobile authenticator (手机令牌), so two-step verification happens on its own.',
      tools: { status: { title: 'Authenticator status' } },
      widgets: { code: { title: 'Authenticator', description: 'Your current 6-digit IAAA code, shown large, with an hourglass counting down to the next one (30 s). Tap to copy.' } },
      screens: { home: { title: 'Authenticator' } },
      settings: { home: { title: 'Authenticator', subtitle: 'One-time codes for automatic two-step verification' } },
    },
  },
  icon: 'key',
  requires: ['campus-session', 'network'],
  scopes: ['iaaa.pku.edu.cn（手机令牌绑定）'],
  contributes: {
    screens: { home: { title: '手机令牌', component: AuthenticatorScreen } },
    settings: [{ screen: 'home', title: '手机令牌', subtitle: '动态验证码，自动二次验证', icon: 'key' }],
    widgets: {
      code: {
        title: '手机令牌',
        description: 'The current IAAA 手机令牌 6-digit code, large, with an hourglass counting down to the next code (30 s). Tap to copy.',
        sizes: ['sm', 'md'],
        defaultSize: 'md',
        component: CodeWidget,
      },
    },
  },
  instructions: `手机令牌（IAAA 动态验证码）由本 App 保管：绑定后，学校登录、树洞课表/成绩的二次验证都会自动完成。
- 用户问是否绑定了手机令牌、为什么还要验证码时，调用 authenticator__status。
- 你不能替用户绑定或查看验证码/密钥；需要绑定时让用户打开「设置 → 手机令牌」，并提醒：绑定会让之前在其他 App 绑定的令牌失效。
- 用户想在看板上看验证码时，可添加本插件的 code 组件。`,
  tools: {
    status: defineTool({
      title: '手机令牌状态',
      description: 'Whether the user has bound this app as their IAAA 手机令牌 (TOTP authenticator), and when. Never returns codes or the secret.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => {
        const s = await ctx.services.campus.otpStatus();
        return {
          bound: s.bound,
          name: s.userName,
          boundAt: s.boundAt ? new Date(s.boundAt).toISOString() : null,
          bindingInProgress: s.pending,
          howToBind: s.bound ? undefined : '设置 → 手机令牌（用户自己操作）',
        };
      },
    }),
  },
});
