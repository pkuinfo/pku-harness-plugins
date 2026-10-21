import { defineStrings, plural } from '@pku-harness/sdk';

/** Reservation states from ic-web (parse.ts STATUS_BITS) and kinds, for display. */
const STATUS_EN: Record<string, string> = {
  被举报: 'Reported',
  待同意: 'Awaiting consent',
  暂离: 'Away',
  审核未通过: 'Rejected',
  待审核: 'Pending review',
  已结束: 'Ended',
  已签到: 'Checked in',
  已违约: 'No-show',
  已生效: 'Active',
  待生效: 'Upcoming',
  审核通过: 'Approved',
  未知: 'Unknown',
};
const KIND_EN: Record<string, string> = { 研讨室: 'Study room', 研修专座: 'Study seat', 座位: 'Seat', 其他: 'Other' };

export const strings = defineStrings({
  'zh-Hans': {
    signIn: '登录',
    retry: '重试',
    noData: '没有数据',
    signedOutLoans: '登录校园账号后显示借阅到期',
    signedOutSpace: '登录校园账号后显示空间预约',
    due: (days: number | null) => (days == null ? '' : days < 0 ? `已超期 ${-days} 天` : days === 0 ? '今天到期' : `${days} 天后到期`),
    loansLabel: '图书馆借阅',
    noLoans: '目前没有在借的书',
    dueLabel: (n: number) => `借阅到期 · 在借 ${n} 本`,
    overdue: (n: number) => `${n} 本超期`,
    renew: '续借',
    askRenew: '看看我借的书哪些能续借，列出来让我确认后续借',
    spaceLabel: '图书馆空间预约',
    noBookings: '暂无预约',
    bookRoom: '约研讨室',
    askRooms: '帮我看看图书馆研讨室今天和明天哪些时段空着',
    kind: (kind: string) => kind,
    status: (status: string) => status,
    checkIn: (status: string) => `${status} · 记得签到`,
  },
  en: {
    signIn: 'Sign in',
    retry: 'Retry',
    noData: 'No data',
    signedOutLoans: 'Sign in to your campus account to see your due dates',
    signedOutSpace: 'Sign in to your campus account to see your bookings',
    due: (days: number | null) => (days == null ? '' : days < 0 ? `${plural(-days, 'day')} overdue` : days === 0 ? 'Due today' : `Due in ${plural(days, 'day')}`),
    loansLabel: 'Library loans',
    noLoans: 'No books on loan',
    dueLabel: (n: number) => `Due · ${n} on loan`,
    overdue: (n: number) => `${n} overdue`,
    renew: 'Renew',
    askRenew: 'Which of my library books can I renew? List them so I can confirm before you renew.',
    spaceLabel: 'Library bookings',
    noBookings: 'No bookings',
    bookRoom: 'Book a room',
    askRooms: 'Which Library study rooms are free today and tomorrow?',
    kind: (kind: string) => KIND_EN[kind] ?? kind,
    status: (status: string) =>
      status
        .split('、')
        .map((p) => STATUS_EN[p] ?? p)
        .join(', '),
    checkIn: (status: string) => `${status} · Remember to check in`,
  },
});
