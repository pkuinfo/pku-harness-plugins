import { defineStrings, plural } from '@pku-harness/sdk';

export const strings = defineStrings({
  'zh-Hans': {
    empty: '课表还是空的',
    addClass: '添加课程',
    doneToday: '今天的课上完了',
    noneToday: '今天没有课',
    week: (n: number) => `第 ${n} 周 · `,
    total: (n: number) => `共 ${n} 节`,
    rest: '好好休息',
    inClass: '上课中',
    inMinutes: (m: number) => `${m} 分钟后`,
    startsAt: (hm: string) => `${hm} 开始`,
    left: (n: number) => `今天还有 ${n} 节`,
    last: '今天最后一节',
  },
  en: {
    empty: 'Your timetable is empty',
    addClass: 'Add class',
    doneToday: 'Classes are over for today',
    noneToday: 'No classes today',
    week: (n: number) => `Week ${n} · `,
    total: (n: number) => plural(n, 'class', 'classes'),
    rest: 'Enjoy the day off',
    inClass: 'In class',
    inMinutes: (m: number) => `In ${m} min`,
    startsAt: (hm: string) => `Starts at ${hm}`,
    left: (n: number) => `${plural(n, 'more class', 'more classes')} today`,
    last: 'Last class today',
  },
});
