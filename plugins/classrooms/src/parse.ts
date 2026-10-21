/**
 * 空闲教室 (pkucli crates/portal/src/freeclassroom.rs), public portal query, no login:
 * - `GET /publicQuery/classroomQuery/retrClassRoomFree.do?buildingName=<中文>&time=今天|明天|后天`
 *   → `{success, rows: [{room, cap, c1…c12}]}`; c<n> = "占用" when period n is taken, "" free.
 * - `GET /publicQuery/classroomQuery/retrClassRoomInfos.do` → `{success, rows: [{buildingName,
 *   classroomFree, classroomSum}]}` (the portal's 教室使用 overview, LifeIndexController.js).
 */

/** freeclassroom.rs BUILDINGS (the portal page offers exactly these ten). */
export const BUILDINGS = ['一教', '二教', '三教', '四教', '理教', '文史', '哲学', '地学', '国关', '政管'] as const;
export type Building = (typeof BUILDINGS)[number];

/** freeclassroom.rs normalize_building aliases, plus full names. */
const ALIASES: Record<string, Building> = {
  '1': '一教', '1教': '一教', 第一教学楼: '一教',
  '2': '二教', '2教': '二教', 第二教学楼: '二教',
  '3': '三教', '3教': '三教', 第三教学楼: '三教',
  '4': '四教', '4教': '四教', 第四教学楼: '四教',
  li: '理教', 理: '理教', 理科教学楼: '理教',
  ws: '文史', 文: '文史', 文史楼: '文史',
  zx: '哲学', 哲: '哲学', 哲学楼: '哲学',
  dx: '地学', 地: '地学', 地学楼: '地学',
  gg: '国关', 国: '国关', 国关楼: '国关', 国际关系学院: '国关',
  zg: '政管', 政: '政管', 政管楼: '政管', 廊坊楼: '政管',
};

export function normalizeBuilding(input: string): Building | null {
  const s = input.trim().replace(/\s+/g, '');
  if ((BUILDINGS as readonly string[]).includes(s)) return s as Building;
  return ALIASES[s] ?? ALIASES[s.toLowerCase()] ?? null;
}

export type Day = 'today' | 'tomorrow' | 'dayAfter';
export const DAY_QUERY: Record<Day, string> = { today: '今天', tomorrow: '明天', dayAfter: '后天' };

/** PKU teaching periods (same table as course-sync DEFAULT_PERIODS and pkucli bdkj PERIODS). */
export const PERIODS: [string, string][] = [
  ['08:00', '08:50'],
  ['09:00', '09:50'],
  ['10:10', '11:00'],
  ['11:10', '12:00'],
  ['13:00', '13:50'],
  ['14:00', '14:50'],
  ['15:10', '16:00'],
  ['16:10', '17:00'],
  ['17:10', '18:00'],
  ['18:40', '19:30'],
  ['19:40', '20:30'],
  ['20:40', '21:30'],
];

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) throw new Error(`时间格式不对：${hhmm}（应为 HH:mm）`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Periods (1-based) overlapping [from, to). */
export function periodsBetween(from: string, to: string): number[] {
  const a = toMin(from);
  const b = toMin(to);
  if (b <= a) throw new Error('结束时间要晚于开始时间');
  return PERIODS.map(([s, e], i) => (toMin(e) > a && toMin(s) < b ? i + 1 : 0)).filter(Boolean);
}

/** Periods not yet over at `minutes` after midnight (the current one included). */
export function remainingPeriods(minutes: number): number[] {
  return PERIODS.map(([, e], i) => (toMin(e) > minutes ? i + 1 : 0)).filter(Boolean);
}

export type Room = { room: string; capacity: number; busy: boolean[] };

export function parseFree(json: string): Room[] {
  let r: { success?: boolean; rows?: Record<string, unknown>[]; message?: string };
  try {
    r = JSON.parse(json);
  } catch {
    throw new Error('空闲教室接口返回了无法解析的内容');
  }
  if (!r.success || !Array.isArray(r.rows)) throw new Error(`空闲教室查询未成功${r.message ? `：${r.message}` : ''}`);
  return r.rows
    .map((row) => ({
      room: String(row.room ?? '').trim(),
      capacity: Number(row.cap) || 0,
      busy: PERIODS.map((_, i) => String(row[`c${i + 1}`] ?? '').trim() !== ''),
    }))
    .filter((x) => x.room);
}

/** "1-2,5,7-12" for a list of period numbers. */
export function compact(periods: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < periods.length; ) {
    let j = i;
    while (j + 1 < periods.length && periods[j + 1] === periods[j] + 1) j++;
    out.push(i === j ? `${periods[i]}` : `${periods[i]}-${periods[j]}`);
    i = j + 1;
  }
  return out.join(',');
}

export type FreeRoom = { building: Building; room: string; capacity: number; freePeriods: string; freeCount: number };

/** Rooms free in every one of `periods`, biggest first (ties: more free periods, then room number). */
export function freeRooms(building: Building, rooms: Room[], periods: number[], minCapacity = 0): FreeRoom[] {
  return rooms
    .filter((r) => r.capacity >= minCapacity && periods.every((p) => !r.busy[p - 1]))
    .map((r) => {
      const free = r.busy.map((b, i) => (b ? 0 : i + 1)).filter(Boolean);
      return { building, room: r.room, capacity: r.capacity, freePeriods: compact(free), freeCount: free.length };
    })
    .sort((a, b) => b.capacity - a.capacity || b.freeCount - a.freeCount || a.room.localeCompare(b.room));
}

export type BuildingSummary = { building: string; free: number; total: number };

export function parseSummary(json: string): BuildingSummary[] {
  let r: { success?: boolean; rows?: { buildingName?: string; classroomFree?: number; classroomSum?: number }[] };
  try {
    r = JSON.parse(json);
  } catch {
    throw new Error('教室概况接口返回了无法解析的内容');
  }
  if (!r.success || !Array.isArray(r.rows)) throw new Error('教室概况查询未成功');
  return r.rows.map((x) => ({ building: String(x.buildingName ?? ''), free: Number(x.classroomFree) || 0, total: Number(x.classroomSum) || 0 })).filter((x) => x.building && x.total > 0);
}

/** Beijing wall clock minutes after midnight (UTC+8, device zone independent). */
export const beijingMinutes = (ms: number) => {
  const d = new Date(ms + 8 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
