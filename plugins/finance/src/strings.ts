import { defineStrings } from '@pku-harness/sdk';

export const strings = defineStrings({
  'zh-Hans': {
    signedOut: '登录校园账号后显示学费住宿费',
    signIn: '登录',
    noData: '没有数据',
    retry: '重试',
    title: '学费住宿费',
    titleUnpaid: '学费住宿费未缴',
    allPaid: '已缴清',
    listSep: '、',
    refreshing: '刷新中…',
    refreshFailed: '刷新失败 · ',
  },
  en: {
    signedOut: 'Sign in to your campus account to see tuition and housing fees',
    signIn: 'Sign in',
    noData: 'No data',
    retry: 'Retry',
    title: 'Tuition and housing',
    titleUnpaid: 'Unpaid tuition and housing',
    allPaid: 'All paid',
    listSep: ', ',
    refreshing: 'Refreshing…',
    refreshFailed: 'Couldn’t refresh · ',
  },
});
