import { definePlugin } from '@pku-harness/sdk';

import { ActiveScreen } from './screens/active';
import { CreateScreen } from './screens/create';
import { ViewScreen } from './screens/view';
import { tools } from './tools';

/**
 * 付款码共享: lend the Campus Card payment code to a friend for a while (docs/CLOUD.md §3.3).
 * The phone stays the only place that can mint codes: it encrypts each one to the friend with
 * a key in the share link's #fragment, and PKU Harness Cloud only relays ciphertext. Gates
 * (PIN, masked name) and the spend cap run on the phone. Successor of pkubdcard, without
 * handing the card session to a server.
 */
export const cardSharePlugin = definePlugin({
  id: 'card-share',
  name: '付款码共享',
  description: '把校园卡付款码临时分享给朋友：端到端加密转发，可设消费上限、口令和姓名验证，随时停止。',
  version: '0.1.0',
  icon: 'share',
  requires: ['campus-session', 'network', 'cloud'],
  cloud: {
    protocol: 1,
    uses: ['channels'],
    e2e: true,
    pages: ['view'],
    disclosure: {
      zh: ['分享期间，加密后的付款码经云服务转发给你分享的人；服务器无法解密', '服务器能看到：分享的开始/结束时间、查看者的 IP'],
      en: ['While you share, encrypted payment codes are relayed by the cloud service to the person you shared with; the server can’t decrypt them', 'The server can see when a share starts and ends, and the viewer’s IP address'],
    },
  },
  defaultModes: { read: 'auto', write: 'auto', money: 'ask' },
  scopes: ['bdcard.pku.edu.cn', 'PKU Harness Cloud（加密转发）'],
  i18n: {
    en: {
      name: 'Share payment code',
      description: 'Lend your Campus Card payment code to a friend for a while: end-to-end encrypted relay, optional spend cap, PIN and name check, stop at any time.',
      tools: {
        list: { title: 'View payment-code shares' },
        revoke: { title: 'Stop payment-code sharing' },
        start: { title: 'Share payment code' },
      },
      screens: { create: { title: 'Share payment code' }, active: { title: 'Share payment code' }, view: { title: 'Payment code' } },
      settings: { active: { title: 'Share payment code', subtitle: 'Lend your payment code to a friend, stop at any time' } },
      commands: { share: { description: 'Share your payment code with a friend', aliases: ['lend'] } },
    },
  },
  contributes: {
    screens: {
      create: { title: '分享付款码', component: CreateScreen, presentation: 'modal' },
      active: { title: '付款码共享', component: ActiveScreen },
      view: { title: '付款码', component: ViewScreen, presentation: 'modal' },
    },
    settings: [{ screen: 'active', title: '付款码共享', subtitle: '把付款码借给朋友，随时停止', icon: 'share' }],
    commands: {
      share: {
        description: '分享付款码给朋友',
        aliases: ['分享付款码', '借卡'],
        run: (_input, { navigate }) => {
          navigate('/m/card-share/create');
        },
      },
    },
  },
  instructions: `付款码共享（card-share）：用户可以把校园卡付款码临时分享给朋友，朋友扫码付款、从用户的卡扣钱。
- 你看不到分享链接，也看不到付款码；不要索要或编造。
- 用户想分享时调用 card-share__start（可带有效期 10m/30m/2h/today、消费上限 capYuan、是否姓名验证/口令），它只保存草稿，返回 awaiting_user；然后告诉用户在 设置 →「付款码共享」或付款码页的「分享给朋友」确认并亲自发出链接（也可以输入 /share）。
- 问分享状态（对方打开没有、出示了几次码、花了多少钱）用 card-share__list；要停止用 card-share__revoke。`,
  tools,
});
