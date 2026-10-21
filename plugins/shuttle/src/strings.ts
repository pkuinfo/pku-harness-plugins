import { defineStrings, weekdayName } from '@pku-harness/sdk';

import type { Area, Departure } from './schedule';

type Strings = {
  /** Short stop names for the widget (no "校区"). */
  areas: Record<Area, string>;
  anyStop: string;
  /** When a departure leaves, relative to now (same rules as `formatIn`). */
  formatIn: (dep: Departure, today: string) => string;
  /** The later departures, "之后 …". */
  later: (list: string) => string;
  a11yNext: (route: string, time: string, when: string) => string;
  a11yNone: (route: string) => string;
  none: string;
  footnote: string;
};

/** Weekday of a "YYYY-MM-DD" date, 1 = Monday … 7 = Sunday. */
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

export const strings = defineStrings<Strings>({
  'zh-Hans': {
    areas: { yanyuan: '燕园', xinyanyuan: '新燕园', lab200: '200号校园', xiaojiahe: '肖家河', xierqi: '西二旗', yangfang: '阳坊', beianhe: '地铁北安河站' },
    anyStop: '任意站',
    formatIn: (dep, today) => {
      if (dep.date !== today) return `${dep.weekday} ${dep.time}`;
      if (dep.inMinutes < 1) return '即将发车';
      if (dep.inMinutes < 60) return `${dep.inMinutes} 分钟后`;
      const h = Math.floor(dep.inMinutes / 60);
      const m = dep.inMinutes % 60;
      return m ? `${h} 小时 ${m} 分钟后` : `${h} 小时后`;
    },
    later: (list) => `之后 ${list}`,
    a11yNext: (route, time, when) => `${route}，下一班 ${time}，${when}`,
    a11yNone: (route) => `${route}，今明两天没有班次`,
    none: '今明两天没有班次',
    footnote: '需在门户「新校区班车预约」预约 · 节假日按周末表',
  },
  en: {
    areas: { yanyuan: 'Yanyuan', xinyanyuan: 'Xinyanyuan', lab200: 'No. 200 Campus', xiaojiahe: 'Xiaojiahe', xierqi: 'Xi’erqi', yangfang: 'Yangfang', beianhe: 'Bei’anhe Station' },
    anyStop: 'Any stop',
    formatIn: (dep, today) => {
      if (dep.date !== today) return `${weekdayName(weekdayOf(dep.date), 'en')} ${dep.time}`;
      if (dep.inMinutes < 1) return 'Leaving now';
      if (dep.inMinutes < 60) return `in ${dep.inMinutes} min`;
      const h = Math.floor(dep.inMinutes / 60);
      const m = dep.inMinutes % 60;
      return m ? `in ${h} h ${m} min` : `in ${h} h`;
    },
    later: (list) => `Then ${list}`,
    a11yNext: (route, time, when) => `${route}, next at ${time}, ${when}`,
    a11yNone: (route) => `${route}, no buses today or tomorrow`,
    none: 'No buses today or tomorrow',
    footnote: 'Book on the portal (新校区班车预约) · Holidays run the weekend timetable',
  },
});

/** Weekday label for a later departure on another day. */
export const departureDay = (dep: Departure, locale: 'zh-Hans' | 'en') => (locale === 'en' ? weekdayName(weekdayOf(dep.date), 'en') : dep.weekday);
