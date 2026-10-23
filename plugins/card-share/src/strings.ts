import { defineStrings, formatCountdown, type AppLocale } from '@pku-harness/sdk';

import type { EndReason } from './protocol';
import type { OngoingText, ShareRecord } from './session';

export const TTL_PRESETS = ['10m', '30m', '2h', 'today'] as const;
export type TtlPreset = (typeof TTL_PRESETS)[number];
export const CAP_PRESETS = [20, 50, 100, 200] as const;

const zhEnd: Record<EndReason, string> = {
  owner: '你已停止',
  expired: '已到期',
  cap: '达到消费上限',
  locked: '验证失败次数过多',
  revoked: '已重置',
  server: '云服务已关闭',
  error: '出错停止',
};
const enEnd: Record<EndReason, string> = {
  owner: 'Stopped by you',
  expired: 'Expired',
  cap: 'Spend cap reached',
  locked: 'Too many wrong answers',
  revoked: 'Reset',
  server: 'Closed by the cloud service',
  error: 'Stopped after an error',
};

export const strings = defineStrings({
  'zh-Hans': {
    title: '付款码共享',
    subtitle: '把付款码借给朋友用一会儿',
    // create
    createTitle: '分享付款码',
    disclaimerTitle: '分享前请知悉',
    disclaimer:
      '这是朋友间互助的小功能。请遵守《北京大学一卡通管理办法》及相关规定，只分享给你信任的人，对账号安全和消费负责。付款码在你的手机上生成，加密后经云服务转发，服务器无法解密。',
    ttl: '有效期',
    ttlLabel: { '10m': '10 分钟', '30m': '30 分钟', '2h': '2 小时', today: '今天' } as Record<TtlPreset, string>,
    cap: '消费上限',
    capValue: (n: number) => `¥${n}`,
    capFooter: '每笔消费后核对，最后一笔可能略超上限；校园卡自己的日限额照常生效。分享期间你自己的消费也计入。',
    gates: '查看者验证',
    nameGate: '姓名验证',
    nameGateHint: '点按姓名中的字把它藏起来，对方要补全下划线处的字',
    namePreview: (hint: string) => `对方看到：${hint}`,
    nameMissing: '没取到持卡人姓名，暂时不能用姓名验证',
    pinGate: '口令',
    pinField: '4–8 位数字口令',
    pinHint: '当面或另行告诉对方，不要和链接一起发',
    gatesFooter: '验证在你的手机上完成；输错 5 次分享自动关闭。链接只能被第一个打开的人使用。',
    create: '生成分享链接',
    creating: '正在生成…',
    // ready
    readyTitle: '分享已开始',
    readyBody: '把链接发给朋友，或让对方扫这个码。对方打开后，你的手机会持续给他推送新的付款码。',
    send: '发送给朋友',
    viewStatus: '查看共享状态',
    done: '完成',
    keepOpen: '分享期间保持网络连接；手机会显示一条「正在共享付款码」的通知，可随时停止。',
    keepOpenIos: '分享期间请保持本 App 在前台。',
    // errors
    needSignIn: '付款码来自校园卡系统，需要先登录校园账号。',
    signIn: '登录校园账号',
    noCloud: '付款码共享通过云服务转发加密后的付款码。请先在 设置 → 云服务 里选择一个服务，并允许本插件使用。',
    consent: '还没有允许「付款码共享」使用云服务：在 设置 → 插件 → 付款码共享 里打开「允许使用云服务」。',
    notDigital: (current: string) => `付款码只能在「数字卡」用卡方式下使用，你现在是「${current}」。`,
    openPay: '去切换',
    pinInvalid: '口令需要 4–8 位数字',
    // active
    activeTitle: '共享中',
    left: (t: string) => `剩 ${t}`,
    noShares: '没有正在进行的分享',
    noSharesBody: '分享付款码给朋友：他扫码付款，钱从你的校园卡扣，随时可以停止。',
    newShare: '新建分享',
    viewerWaiting: '等待对方打开',
    viewerGate: '已打开 · 等待验证',
    viewerLive: '正在查看',
    viewerAway: '对方已离开',
    codes: '已出示',
    codesValue: (n: number) => `${n} 次`,
    spent: '已消费',
    capOf: (n: number) => `上限 ¥${n}`,
    noCap: '未设上限',
    failures: (n: number) => `验证失败 ${n} 次`,
    paused: '暂停出码',
    stop: '停止分享',
    extend: '延长 30 分钟',
    resetViewer: '重置查看者',
    resetHint: '让另一个人重新打开',
    resetNewLink: '已生成新的分享链接，旧链接作废。把新链接发给对方。',
    resend: '再次发送链接',
    history: '最近的分享',
    summary: (spent: string, n: number) => (n ? `消费 ¥${spent}（${n} 笔）` : '没有消费'),
    ended: (r: EndReason) => zhEnd[r],
    payments: '期间消费',
    devMock: '模拟付款码（开发）',
    devMockHint: '不连校园卡，用假付款码和假消费测试分享流程',
    // view (in-app viewer)
    viewTitle: '付款码',
    from: (label: string) => `来自 ${label} 的卡`,
    someone: '朋友',
    loading: '正在连接…',
    gateTitle: '验证一下',
    nameField: (hint: string) => `补全姓名：${hint}`,
    nameFieldHint: '按顺序填写下划线处的字',
    pinFieldView: '口令',
    verify: '验证',
    wrong: (left: number) => `不对，还能试 ${left} 次`,
    showCashier: '向收银员出示',
    refreshIn: (s: number) => `${s} 秒后换新码`,
    balance: (b: string) => `余额 ¥${b}`,
    waitingCode: '正在等待付款码…',
    sharerOffline: '分享者暂时离线，恢复后会自动推送新码',
    pausedView: '分享者暂时无法出码',
    cappedView: '已达到消费上限',
    revokedView: '分享已结束',
    expiredView: '分享已过期',
    takenView: '这个链接已经被别人打开了',
    badLink: '链接无效或不完整',
    retry: '重试',
    close: '关闭',
    // ongoing notification
    ongoingTitle: '正在共享付款码',
    ongoingStop: '停止',
  },
  en: {
    title: 'Share payment code',
    subtitle: 'Lend your payment code to a friend for a while',
    createTitle: 'Share payment code',
    disclaimerTitle: 'Before you share',
    disclaimer:
      'This is for helping friends out. Follow the Peking University Campus Card rules (北京大学一卡通管理办法), share only with people you trust, and you are responsible for the account and what is spent. Codes are made on your phone and relayed encrypted by the cloud service, which can’t read them.',
    ttl: 'Valid for',
    ttlLabel: { '10m': '10 min', '30m': '30 min', '2h': '2 hours', today: 'Today' } as Record<TtlPreset, string>,
    cap: 'Spend cap',
    capValue: (n: number) => `¥${n}`,
    capFooter: 'Checked after each payment, so the last one can go slightly over. Your card’s own daily limit still applies. Your own spending during the share counts too.',
    gates: 'Check the viewer',
    nameGate: 'Name check',
    nameGateHint: 'Tap characters of your name to hide them; your friend fills in the blanks',
    namePreview: (hint: string) => `They see: ${hint}`,
    nameMissing: 'Couldn’t read the cardholder’s name, so the name check is unavailable',
    pinGate: 'PIN',
    pinField: '4–8 digit PIN',
    pinHint: 'Tell it to them in person or separately, not with the link',
    gatesFooter: 'Checked on your phone; 5 wrong answers close the share. Only the first person who opens the link can use it.',
    create: 'Create share link',
    creating: 'Creating…',
    readyTitle: 'Sharing started',
    readyBody: 'Send the link to your friend or let them scan this code. Once they open it, your phone keeps sending them fresh payment codes.',
    send: 'Send to a friend',
    viewStatus: 'Sharing status',
    done: 'Done',
    keepOpen: 'Stay online while sharing. A “Sharing payment code” notification stays up; you can stop from there at any time.',
    keepOpenIos: 'Keep this app open while sharing.',
    needSignIn: 'The payment code comes from the Campus Card system, so sign in to your campus account first.',
    signIn: 'Sign in to campus account',
    noCloud: 'Sharing relays encrypted payment codes through a cloud service. Choose one in Settings → Cloud and allow this plugin to use it.',
    consent: 'Share payment code isn’t allowed to use the cloud yet: turn on “Allow cloud” in Settings → Plugins → Share payment code.',
    notDigital: (current: string) => `Payment codes only work in digital card mode (数字卡); you’re using “${current}”.`,
    openPay: 'Switch',
    pinInvalid: 'The PIN must be 4–8 digits',
    activeTitle: 'Sharing',
    left: (t: string) => `${t} left`,
    noShares: 'Nothing is being shared',
    noSharesBody: 'Share your payment code with a friend: they scan to pay from your Campus Card, and you can stop at any time.',
    newShare: 'New share',
    viewerWaiting: 'Waiting for them to open it',
    viewerGate: 'Opened · checking',
    viewerLive: 'Viewing',
    viewerAway: 'They left',
    codes: 'Codes shown',
    codesValue: (n: number) => `${n}`,
    spent: 'Spent',
    capOf: (n: number) => `cap ¥${n}`,
    noCap: 'No cap',
    failures: (n: number) => `${n} wrong ${n === 1 ? 'answer' : 'answers'}`,
    paused: 'Paused',
    stop: 'Stop sharing',
    extend: 'Add 30 min',
    resetViewer: 'Reset viewer',
    resetHint: 'Let someone else open it',
    resetNewLink: 'A new share link replaced the old one. Send the new link.',
    resend: 'Send link again',
    history: 'Recent shares',
    summary: (spent: string, n: number) => (n ? `Spent ¥${spent} (${n} ${n === 1 ? 'payment' : 'payments'})` : 'Nothing spent'),
    ended: (r: EndReason) => enEnd[r],
    payments: 'Payments',
    devMock: 'Mock payment codes (dev)',
    devMockHint: 'Test the share flow with fake codes and payments, without the Campus Card',
    viewTitle: 'Payment code',
    from: (label: string) => `From ${label}’s card`,
    someone: 'a friend',
    loading: 'Connecting…',
    gateTitle: 'Quick check',
    nameField: (hint: string) => `Complete the name: ${hint}`,
    nameFieldHint: 'Type the hidden characters in order',
    pinFieldView: 'PIN',
    verify: 'Verify',
    wrong: (left: number) => `Not right, ${left} ${left === 1 ? 'try' : 'tries'} left`,
    showCashier: 'Show this to the cashier',
    refreshIn: (s: number) => `New code in ${s} s`,
    balance: (b: string) => `Balance ¥${b}`,
    waitingCode: 'Waiting for a payment code…',
    sharerOffline: 'The sharer is offline for now; a fresh code arrives when they’re back',
    pausedView: 'The sharer can’t make codes right now',
    cappedView: 'Spend cap reached',
    revokedView: 'The share has ended',
    expiredView: 'The share has expired',
    takenView: 'Someone else already opened this link',
    badLink: 'The link is invalid or incomplete',
    retry: 'Retry',
    close: 'Close',
    ongoingTitle: 'Sharing payment code',
    ongoingStop: 'Stop',
  },
});

export type Strings = (typeof strings)['zh-Hans'];

/** TTL in seconds for a preset; "today" runs to 23:59 local time (at least 10 minutes). */
export function ttlSeconds(preset: TtlPreset, now: number = Date.now()): number {
  switch (preset) {
    case '10m':
      return 600;
    case '30m':
      return 1800;
    case '2h':
      return 7200;
    case 'today': {
      const end = new Date(now);
      end.setHours(23, 59, 0, 0);
      return Math.max(600, Math.round((end.getTime() - now) / 1000));
    }
  }
}

export const yuanText = (n: number) => n.toFixed(2);

/** The ongoing notification's texts ("剩 28分钟 · 已出示 2 次 · ¥12.50"). */
export function ongoingText(locale: AppLocale): OngoingText {
  const s = strings[locale];
  return {
    title: s.ongoingTitle,
    stop: s.ongoingStop,
    body: (r: ShareRecord, now: number) => {
      const parts = [s.left(formatCountdown(r.expiresAt - now, locale))];
      parts.push(locale === 'en' ? `${r.codesIssued} shown` : `已出示 ${r.codesIssued} 次`);
      if (r.spent > 0) parts.push(`¥${yuanText(r.spent)}`);
      if (r.viewer && !r.viewer.verified) parts.push(s.viewerGate);
      return parts.join(' · ');
    },
  };
}
