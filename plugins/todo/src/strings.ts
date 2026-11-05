import { defineStrings } from '@pku-harness/sdk';

export const strings = defineStrings({
  'zh-Hans': {
    label: '待办',
    allDone: '全部完成',
    nothingToday: '今天没有要做的事',
    nextUp: (title: string, when: string) => `下一个：${when} ${title}`,
    dueCount: (n: number) => `${n} 项待办`,
    overdueCount: (n: number) => `${n} 项已逾期`,
    more: (n: number) => `还有 ${n} 项`,
    overdue: '逾期 ',
    tomorrow: '明天',
    complete: (title: string) => `完成「${title}」`,
    openSchedule: '打开日程',
  },
  en: {
    label: 'To-dos',
    allDone: 'All done',
    nothingToday: 'Nothing due today',
    nextUp: (title: string, when: string) => `Next: ${title}, ${when}`,
    dueCount: (n: number) => (n === 1 ? '1 to-do' : `${n} to-dos`),
    overdueCount: (n: number) => `${n} overdue`,
    more: (n: number) => `${n} more`,
    overdue: 'Overdue · ',
    tomorrow: 'Tomorrow',
    complete: (title: string) => `Complete “${title}”`,
    openSchedule: 'Open Schedule',
  },
});
