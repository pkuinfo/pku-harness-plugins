import { defineStrings } from '@pku-harness/sdk';

export const strings = defineStrings({
  'zh-Hans': {
    signedOut: '登录校园账号后显示网费',
    signIn: '登录',
    noData: '没有数据',
    retry: '重试',
    label: '网费',
    thisMonth: (usage: string) => `本月 ${usage}`,
    refreshing: '刷新中…',
    refreshFailed: '刷新失败 · ',
  },
  en: {
    signedOut: 'Sign in to your campus account to see your network fee',
    signIn: 'Sign in',
    noData: 'No data',
    retry: 'Retry',
    label: 'Network fee',
    thisMonth: (usage: string) => `This month ${usage}`,
    refreshing: 'Refreshing…',
    refreshFailed: 'Couldn’t refresh · ',
  },
});
