import { defineStrings } from '@pku-harness/sdk';

export const strings = defineStrings({
  'zh-Hans': {
    noData: '暂时没有读到通知',
    retry: '重试',
    summarise: (title: string, url: string) => `帮我读一下这条通知并总结要点：${title} ${url}`,
    hint: '打开原文，长按让 AI 总结',
    refreshing: '刷新中…',
    refreshFailed: '刷新失败 · ',
    /** Source names as the parser reports them → display name (Chinese: as is). */
    sources: {} as Record<string, string>,
  },
  en: {
    noData: 'No notices right now',
    retry: 'Retry',
    summarise: (title: string, url: string) => `Read this notice and sum up the key points: ${title} ${url}`,
    hint: 'Opens the original; long-press to have the AI summarise it',
    refreshing: 'Refreshing…',
    refreshFailed: 'Couldn’t refresh · ',
    sources: {
      教务部: 'Educational Administration',
      研究生院: 'Graduate School',
      学生工作部: 'Student Affairs',
      总务部: 'General Services',
      北大新闻网: 'PKU News',
      学校主页通知公告: 'PKU homepage',
    } as Record<string, string>,
  },
});
