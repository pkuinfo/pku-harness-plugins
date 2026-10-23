import { definePlugin, defineTool, type KV } from '@pku-harness/sdk';
import { z } from 'zod';

import { getText } from './http';
import { beijingMinutes, BUILDINGS, compact, DAY_QUERY, freeRooms, normalizeBuilding, parseFree, parseSummary, periodsBetween, PERIODS, remainingPeriods, type Building, type Day, type Room } from './parse';
import { FreeClassroomsWidget } from './widget';

/** pkucli crates/portal/src/client.rs PORTAL_PUBLIC_BASE; freeclassroom.rs sends this referer. */
const BASE = 'https://portal.pku.edu.cn/publicQuery';
const HEADERS = { referer: `${BASE}/`, accept: 'application/json, text/plain, */*' };
/** Room usage changes when bookings are made; 10 minutes keeps follow-up questions instant. */
const TTL = 10 * 60_000;

async function rooms(kv: KV, building: Building, day: Day, signal?: AbortSignal): Promise<Room[]> {
  const key = `free:${building}:${day}`;
  const cached = await kv.get<{ at: number; rooms: Room[] }>(key);
  if (cached && Date.now() - cached.at < TTL) return cached.rooms;
  const url = `${BASE}/classroomQuery/retrClassRoomFree.do?buildingName=${encodeURIComponent(building)}&time=${encodeURIComponent(DAY_QUERY[day])}`;
  const list = parseFree(await getText(url, { headers: HEADERS, signal }));
  await kv.set(key, { at: Date.now(), rooms: list });
  return list;
}

const dayEnum = z.enum(['today', 'tomorrow', 'dayAfter']);
const periodTable = PERIODS.map(([s, e], i) => `${i + 1}:${s}-${e}`).join(' ');

/** 空闲教室 from the portal's public query (pkucli crates/portal/src/freeclassroom.rs). */
export const classroomsPlugin = definePlugin({
  id: 'classrooms',
  name: '空闲教室',
  description: '查一教、二教、三教、四教、理教等教学楼今天到后天每节课的空闲教室，找自习室。',
  version: '0.1.0',
  i18n: {
    en: {
      name: 'Free classrooms',
      description: 'Free classrooms in each teaching building (First to Fourth, Science Teaching Building and more) for every period from today to the day after tomorrow. Find somewhere to study.',
      tools: { free: { title: 'Free classrooms' }, overview: { title: 'Free rooms by building' } },
      widgets: { overview: { title: 'Free classrooms', description: 'How many classrooms are free in each teaching building right now (from the portal); tap a building to have the AI list them.' } },
      commands: { classrooms: { prompt: 'Find me a free classroom to study in{{input}}', description: 'Find a free classroom to study in', argHint: 'Building and time', aliases: ['study', 'free-rooms'] } },
      dataSources: { overview: { title: 'Free rooms by building' } },
    },
  },
  icon: 'building',
  requires: ['network'],
  scopes: ['portal.pku.edu.cn（公开查询：空闲教室）'],
  contributes: {
    widgets: {
      overview: {
        title: '空闲教室',
        description: '各教学楼现在的空闲教室数（门户教室使用概况），点按一栋楼让 AI 列出空教室。',
        sizes: ['sm', 'md', 'lg'],
        defaultSize: 'md',
        component: FreeClassroomsWidget,
      },
    },
    commands: {
      classrooms: { description: '找空闲教室自习', aliases: ['空教室', '自习'], argHint: '如 二教 下午', prompt: '帮我找能自习的空闲教室{{input}}' },
    },
  },
  instructions: `空闲教室（公开数据，无需登录）：
- classrooms__free：某栋楼（或不传 building 查全部 10 栋）在今天/明天/后天的空闲教室。用户说"下午""晚上""现在到 6 点"时换算成 from/to（HH:mm）或节次 periods；不传时今天默认从当前节次到晚上。
- 节次：${periodTable}。
- classrooms__overview：各楼现在空闲教室数量，适合先挑楼。
- 数据只覆盖排课和教务预约，临时活动可能未登记；回答时建议选座位多、空闲时间长的教室。`,
  dataSources: {
    overview: { title: '各楼空闲教室数', tool: 'overview', ttlMs: 10 * 60_000 },
  },
  tools: {
    free: defineTool({
      title: '空闲教室',
      description: `Classrooms free during every requested period: building, room, capacity, all free periods of that day (e.g. "1-2,5-12"). Buildings: ${BUILDINGS.join(' ')} (omit = all ten, queried in parallel). Pick periods with \`periods\` (1–12) or a time window \`from\`/\`to\` (HH:mm); default today = from the current period to the end of the day, other days = all 12. Biggest rooms first.`,
      input: z.object({
        building: z.string().trim().max(10).optional().describe('e.g. 二教, 理教, 3, 文史'),
        day: dayEnum.optional().describe('today (default), tomorrow, dayAfter'),
        periods: z.array(z.number().int().min(1).max(12)).max(12).optional(),
        from: z.string().optional().describe('window start HH:mm'),
        to: z.string().optional().describe('window end HH:mm'),
        minCapacity: z.number().int().min(0).max(1000).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('max rooms, default 30'),
      }),
      effect: 'read',
      execute: async ({ building, day = 'today', periods, from, to, minCapacity = 0, limit = 30 }, ctx) => {
        let targets: Building[] = [...BUILDINGS];
        if (building) {
          const b = normalizeBuilding(building);
          if (!b) throw new Error(`没有「${building}」的空闲教室数据。可查：${BUILDINGS.join('、')}`);
          targets = [b];
        }
        const wanted = periods?.length ? [...new Set(periods)].sort((a, b) => a - b) : from || to ? periodsBetween(from ?? '08:00', to ?? '21:30') : day === 'today' ? remainingPeriods(beijingMinutes(Date.now())) : PERIODS.map((_, i) => i + 1);
        if (!wanted.length) return { day, periods: '', rooms: [], note: '今天的课已经全部结束（第 12 节 21:30 结束），可以查明天。' };
        const failed: { building: string; error: string }[] = [];
        const lists = await Promise.all(
          targets.map(async (b) => {
            try {
              return freeRooms(b, await rooms(ctx.kv, b, day, ctx.signal), wanted, minCapacity);
            } catch (e) {
              failed.push({ building: b, error: e instanceof Error ? e.message : String(e) });
              return [];
            }
          }),
        );
        if (failed.length === targets.length) throw new Error(`空闲教室查询失败：${failed[0].error}`);
        const all = lists.flat().sort((a, b) => b.capacity - a.capacity || b.freeCount - a.freeCount);
        return {
          day,
          periods: compact(wanted),
          times: `${PERIODS[wanted[0] - 1][0]}-${PERIODS[wanted.at(-1)! - 1][1]}`,
          total: all.length,
          rooms: all.slice(0, limit),
          ...(all.length > limit ? { truncated: true } : {}),
          ...(failed.length ? { failed } : {}),
          source: `${BASE}/#/freeClassroom`,
        };
      },
    }),
    overview: defineTool({
      title: '各楼空闲教室数',
      description: 'How many classrooms are free right now in each teaching building (portal overview): building, free, total.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => {
        const list = parseSummary(await getText(`${BASE}/classroomQuery/retrClassRoomInfos.do`, { headers: HEADERS, signal: ctx.signal }));
        return { buildings: list.sort((a, b) => b.free - a.free), source: `${BASE}/#/lifeIndex` };
      },
    }),
  },
});
