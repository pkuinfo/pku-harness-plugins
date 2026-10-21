import { defineStrings } from '@pku-harness/sdk';

export const strings = defineStrings({
  'zh-Hans': {
    signedOut: '登录校园账号后显示绩点',
    signIn: '登录',
    verifyNeeded: '查看成绩需要验证',
    noData: '没有数据',
    verify: '去验证',
    askGpa: '帮我查一下总绩点',
    retry: '重试',
    label: '总绩点',
    hide: '隐藏绩点',
    show: '显示绩点',
    credits: (n: number) => `已修 ${n} 学分`,
  },
  en: {
    signedOut: 'Sign in to your campus account to see your GPA',
    signIn: 'Sign in',
    verifyNeeded: 'Verification needed to see grades',
    noData: 'No data',
    verify: 'Verify',
    askGpa: 'What’s my overall GPA?',
    retry: 'Retry',
    label: 'Overall GPA',
    hide: 'Hide GPA',
    show: 'Show GPA',
    credits: (n: number) => `${n} credits earned`,
  },
});
