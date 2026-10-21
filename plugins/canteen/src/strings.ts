import { defineStrings } from '@pku-harness/sdk';

export const strings = defineStrings({
  'zh-Hans': {
    noData: '暂时没有食堂人数数据',
    retry: '重试',
    levels: { 空闲: '空闲', 适中: '适中', 较挤: '较挤', 拥挤: '拥挤' },
    a11y: (name: string, diners: number, level: string) => `${name}，${diners} 人，${level}`,
    refreshing: '刷新中…',
    refreshFailed: '刷新失败 · ',
    dataTime: (hm: string) => `数据时间 ${hm}`,
  },
  en: {
    noData: 'No canteen data right now',
    retry: 'Retry',
    levels: { 空闲: 'Quiet', 适中: 'Moderate', 较挤: 'Busy', 拥挤: 'Packed' },
    a11y: (name: string, diners: number, level: string) => `${name}, ${diners} ${diners === 1 ? 'diner' : 'diners'}, ${level}`,
    refreshing: 'Refreshing…',
    refreshFailed: 'Couldn’t refresh · ',
    dataTime: (hm: string) => `As of ${hm}`,
  },
});
