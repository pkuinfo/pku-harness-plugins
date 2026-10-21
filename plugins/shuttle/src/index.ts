import { definePlugin, defineTool } from '@pku-harness/sdk';
import { z } from 'zod';

import { LINES, STOPS } from './data';
import { AREA_NAMES, beijing, dayTypeOf, nextDepartures, parseBeijing, quickAnswer, resolvePlace, timetable } from './schedule';
import { NextShuttleWidget } from './widget';

const dayType = z.enum(['weekday', 'holiday']).describe('weekday = 周一至周五 table; holiday = 周六日、法定节假日及寒暑假 table');
const sources = Object.values(LINES).map((l) => ({ line: l.name, ...l.source }));
const placeHint = '燕园/本部, 新燕园/昌平, 200号, 肖家河, 西二旗, 阳坊, 北安河(地铁)';

/**
 * 校车 / 班车: PKU's inter-campus commuter bus (燕园 ⇄ 新燕园 ⇄ 200号) and the 新燕园 ⇄ 地铁北安河
 * express bus. The school publishes only images / notice text, so the timetables are static data
 * (./data.ts) with their source URL and date; departures are computed in Beijing time.
 */
export const shuttlePlugin = definePlugin({
  id: 'shuttle',
  name: '校车',
  description: '燕园—新燕园（昌平）通勤班车和新燕园—地铁北安河快速公交时刻表，算出下一班车。',
  version: '0.1.0',
  icon: 'location',
  requires: [],
  scopes: [],
  contributes: {
    widgets: {
      next: {
        title: '下一班校车',
        description: '燕园⇄新燕园通勤班车的下一班（倒计时），本地计算无需联网；config.from / config.to 可换成别的站（如 新燕园→北安河）。',
        sizes: ['sm', 'md', 'lg'],
        defaultSize: 'md',
        configSchema: z.object({
          from: z.string().optional().describe(`boarding place, e.g. 燕园 / 新燕园 (${placeHint})`),
          to: z.string().optional().describe('destination place'),
        }),
        component: NextShuttleWidget,
      },
    },
    commands: {
      shuttle: { description: '下一班校车（本地计算）', aliases: ['校车', '班车'], argHint: '如 燕园到新燕园', run: (input) => quickAnswer(input) },
    },
  },
  instructions: `校车（静态时刻表，来自学校公布的图片/通知，附来源和日期）：
- shuttle__next：下一班车。用户说"去昌平/新校区的车""回本部"时换算成 from/to（${placeHint}）。周六日自动用周末表；法定节假日、寒暑假要传 dayType "holiday"（拿不准时可先用 calendar__officialCalendar 查节假日）。
- shuttle__timetable：整张时刻表、上车地点、预约规则和数据来源。
- 通勤班车免费但必须提前在校内门户「办事大厅 → 新校区班车预约」预约、登车扫码签到；北安河快速公交是公交公司运营、收费、无需预约。
- 时刻表是 ${LINES.commute.source.published} 发布的版本，回答时说明"以预约系统为准"；用户要提醒时可以用提醒工具在发车前提醒。`,
  dataSources: {
    next: { title: '下一班校车', tool: 'next', args: { count: 2 }, ttlMs: 60_000 },
  },
  tools: {
    next: defineTool({
      title: '下一班校车',
      description: `Next departures (Beijing time) from → to, searching today and tomorrow: date, time, minutes until, boarding spot, route, line. Places: ${placeHint}. Without from/to: next runs both ways between 燕园 and 新燕园. \`at\` = "YYYY-MM-DD HH:mm" to plan ahead. Intermediate stops (肖家河, 西二旗) have no published times: those results are marked approx and show the origin's departure.`,
      input: z.object({
        from: z.string().trim().max(20).optional().describe('boarding place'),
        to: z.string().trim().max(20).optional().describe('destination'),
        at: z.string().optional().describe('Beijing time "YYYY-MM-DD HH:mm", default now'),
        count: z.number().int().min(1).max(10).optional().describe('departures per direction, default 3'),
        dayType: dayType.optional().describe('override the table for that day (public holiday / vacation = holiday)'),
      }),
      effect: 'read',
      execute: async ({ from, to, at, count = 3, dayType: type }) => {
        const nowMs = at ? parseBeijing(at) : Date.now();
        if (nowMs == null) throw new Error(`时间格式不对：${at}（应为 YYYY-MM-DD HH:mm）`);
        const f = resolvePlace(from);
        const t = resolvePlace(to);
        if (from && !f) throw new Error(`不认识的地点：${from}（可用：${placeHint}）`);
        if (to && !t) throw new Error(`不认识的地点：${to}（可用：${placeHint}）`);
        const now = beijing(nowMs);
        const pairs = f || t ? [{ from: f, to: t }] : [{ from: 'yanyuan' as const, to: 'xinyanyuan' as const }, { from: 'xinyanyuan' as const, to: 'yanyuan' as const }];
        return {
          now: now.text,
          dayType: type ?? dayTypeOf(now.weekday),
          directions: pairs.map((p) => ({
            from: p.from ? AREA_NAMES[p.from] : null,
            to: p.to ? AREA_NAMES[p.to] : null,
            departures: nextDepartures({ from: p.from, to: p.to, nowMs, count, dayType: type }),
          })),
          booking: LINES.commute.booking,
          sources,
        };
      },
    }),
    timetable: defineTool({
      title: '校车时刻表',
      description: 'Full timetables (weekday and weekend/holiday) grouped by direction, with boarding spots, booking rules, fares, notes and the source URL + publish date of each line.',
      input: z.object({
        dayType: dayType.optional().describe('only this table; default both'),
        line: z.enum(['commute', 'beianhe']).optional().describe('commute = 燕园—新燕园通勤班车, beianhe = 新燕园—北安河快速公交'),
      }),
      effect: 'read',
      execute: async ({ dayType: type, line }) => ({
        today: beijing(Date.now()).text,
        tables: (type ? [type] : (['weekday', 'holiday'] as const)).map((d) => ({ dayType: d, groups: timetable(d, line) })),
        stops: Object.values(STOPS).map((s) => ({ name: s.name, where: s.where })),
        lines: Object.values(LINES)
          .filter((l) => !line || l.id === line)
          .map((l) => ({ name: l.name, operator: l.operator, fare: l.fare, booking: l.booking, notes: l.notes, source: l.source })),
      }),
    }),
  },
});
