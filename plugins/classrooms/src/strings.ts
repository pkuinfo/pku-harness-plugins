import { defineStrings } from '@pku-harness/sdk';

export const strings = defineStrings({
  'zh-Hans': {
    noData: '暂时没有教室数据',
    retry: '重试',
    ask: (building: string) => `${building}现在有哪些空闲教室？`,
    a11y: (building: string, free: number, total: number) => `${building}，${free} 间空闲，共 ${total} 间`,
    refreshing: '刷新中…',
    refreshFailed: '刷新失败 · ',
    freeNow: '现在空闲 · ',
  },
  en: {
    noData: 'No classroom data right now',
    retry: 'Retry',
    ask: (building: string) => `Which classrooms in ${building} are free right now?`,
    a11y: (building: string, free: number, total: number) => `${building}, ${free} of ${total} free`,
    refreshing: 'Refreshing…',
    refreshFailed: 'Couldn’t refresh · ',
    freeNow: 'Free now · ',
  },
});
