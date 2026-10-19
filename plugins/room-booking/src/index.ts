import { definePlugin, defineTool, type KV } from '@pku-harness/sdk';
import { z } from 'zod';

import { cancel, checkCanApply, listApplications, schedule, searchStudent, space, submit } from './api';
import { freeSlots, matchBuilding, normalizeTime, overlaps, type Student } from './parse';

/**
 * 北大空间 学术研讨教室预约 (bdkj.pku.edu.cn, redesigned 2026-10; pkucli crates/bdkj for the
 * older flows): rooms in 二教 / 四教 / 地学, free periods, my reservations, reserve and cancel.
 * Participant groups (groups.rs) live in the plugin's kv.
 */

const member = z.object({
  serial: z.string().trim().regex(/^\d{5,12}$/, '学号应为数字'),
  name: z.string().trim().min(1).max(20),
});
type Member = z.infer<typeof member>;
type Groups = Record<string, Member[]>;

const loadGroups = async (kv: KV) => (await kv.get<Groups>('groups')) ?? {};

// Plain strings (no transform) so the input stays representable as JSON Schema; normalized in execute.
const time = z
  .string()
  .trim()
  .refine((t) => normalizeTime(t) != null, '时间格式应为 YYYY-MM-DD HH:MM')
  .describe('local time "YYYY-MM-DD HH:MM"');

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStamp = (d: Date) => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const minutes = (stamp: string) => new Date(stamp.replace(' ', 'T')).getTime() / 60_000;

const reserveInput = z
  .object({
    roomId: z.string().trim().regex(/^\d+$/, '教室 id 来自 room-booking__rooms').describe('room id from room-booking__rooms'),
    begin: time,
    end: time,
    reason: z.string().trim().min(2).max(100).describe('预约事由, e.g. 课题组讨论'),
    participants: z.array(member).min(1).max(30).optional().describe('everyone attending, INCLUDING the applicant (the user); at least 3 people'),
    group: z.string().trim().min(1).optional().describe('name of a saved participant group (room-booking__groups) instead of participants'),
  })
  .refine((v) => !!v.participants !== !!v.group, { message: '参与人二选一：participants（学号+姓名列表）或 group（已保存的分组名）' })
  .refine((v) => {
    const [b, e] = [normalizeTime(v.begin), normalizeTime(v.end)];
    return !b || !e || (b.slice(0, 10) === e.slice(0, 10) && b < e);
  }, { message: '结束时间要晚于开始时间，且在同一天' });

export const roomBookingPlugin = definePlugin({
  id: 'room-booking',
  name: '研讨室预约',
  description: '北大空间：二教、四教、地学楼学术研讨教室的查询、预约和取消。',
  version: '0.2.0',
  icon: 'calendar',
  requires: ['campus-session', 'network'],
  scopes: ['bdkj.pku.edu.cn'],
  instructions: `北大空间（bdkj.pku.edu.cn）学术研讨教室：用户说借教室、订研讨室、预约讨论间时用。
- 流程：room-booking__rooms 列出楼和教室（可按楼、人数筛选）→ room-booking__availability 看某间教室每天的空闲节次 → room-booking__reserve 提交。
- 每天 13 节、每节 50 分钟（08:00–22:30），一次最多连续 2 节；预约时间用 availability 返回的节次起止时间。
- 每间教室有「至少 N 人起约」和容量限制，预约至少 3 人，参与人必须包含申请人（用户本人）；每人要学号和姓名。参与人必须由用户明确给出，不要编造或沿用别人的名单。用户固定的一组人可以用 room-booking__saveGroup 存成分组，之后 reserve 传 group。
- reserve / cancel 会真的改动学校的预约记录：提交前把教室、时间、事由、参与人跟用户确认一遍。
- room-booking__reservations 查看我的预约（含可取消的 id），cancel 传那里的 id。
- 如果提示需要完善「个人信息」，原样告诉用户去浏览器打开 https://bdkj.pku.edu.cn/personal 完成，不要反复重试。`,
  tools: {
    rooms: defineTool({
      title: '研讨教室列表',
      description:
        'Buildings and discussion rooms on 北大空间 (二教, 四教, 地学): room id, name, code, floor, capacity, minimum party size, door and screen state. Optional filters: building (name or number) and minCapacity.',
      input: z.object({
        building: z.string().trim().min(1).optional().describe('二教, 四教 or 地学 (or 02 / 04 / 09)'),
        minCapacity: z.number().int().min(1).max(200).optional().describe('only rooms that hold at least this many people'),
      }),
      effect: 'read',
      execute: async ({ building, minCapacity }, ctx) => {
        const { buildings, rooms } = await space(ctx.services);
        let list = rooms;
        if (building) {
          const b = matchBuilding(building, buildings);
          if (!b) throw new Error(`没有这栋楼：${building}。可选：${buildings.map((x) => x.name).join('、') || '二教、四教、地学'}`);
          list = list.filter((r) => r.buildingId === b.id);
        }
        if (minCapacity) list = list.filter((r) => r.capacity == null || r.capacity >= minCapacity);
        return { buildings, rooms: list.map(({ applyHref: _href, ...r }) => r) };
      },
    }),
    availability: defineTool({
      title: '教室空闲时段',
      description:
        'Free 50-minute periods of one room per day (13 periods 08:00–22:30; at most 2 consecutive per booking), plus the taken slots. Starts today or at `date`, for `days` days (max 7). Periods that already started are omitted.',
      input: z.object({
        roomId: z.string().trim().regex(/^\d+$/).describe('room id from room-booking__rooms'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD, default today'),
        days: z.number().int().min(1).max(7).optional().describe('number of days from date, default 1'),
      }),
      effect: 'read',
      execute: async ({ roomId, date, days }, ctx) => {
        const now = new Date();
        const start = date ?? localDate(now);
        const [y, m, d] = start.split('-').map(Number);
        const dates = Array.from({ length: days ?? 1 }, (_, i) => localDate(new Date(y, m - 1, d + i)));
        const taken = await schedule(ctx.services, roomId, start);
        return freeSlots(dates, taken, localStamp(now));
      },
    }),
    reservations: defineTool({
      title: '我的研讨室预约',
      description: 'My room reservations (newest first as listed by the site): room, time, status, participants, and the id to cancel with.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => listApplications(ctx.services),
    }),
    reserve: defineTool({
      title: '预约研讨教室',
      description:
        'Book a discussion room for one or two consecutive periods (times from room-booking__availability). Needs ≥3 participants (and at least the room\'s minimum party size) including the user, given explicitly (participants) or as a saved group. Each participant is verified by student id + name before submitting. Confirm details with the user first. NOTE: the submit step is the pre-2026 flow and is not yet verified against the redesigned site; if the user\'s 北大空间 profile is incomplete it fails with a message telling them to complete it in a browser.',
      input: reserveInput,
      effect: 'write',
      execute: async ({ roomId, reason, participants, group, ...times }, ctx) => {
        const begin = normalizeTime(times.begin);
        const end = normalizeTime(times.end);
        if (!begin || !end) throw new Error('时间格式应为 YYYY-MM-DD HH:MM');
        let members: Member[];
        if (group) {
          const saved = (await loadGroups(ctx.kv))[group];
          if (!saved) throw new Error(`没有名为「${group}」的分组，先用 room-booking__saveGroup 保存`);
          members = saved;
        } else members = participants ?? [];
        const seen = new Set<string>();
        members = members.filter((m) => !seen.has(m.serial) && !!seen.add(m.serial));
        if (members.length < 3) throw new Error(`申请教室要求不少于 3 人（包含申请人），当前 ${members.length} 人`);
        const me = ctx.services.campus.status().username;
        if (me && !seen.has(me)) throw new Error('参与人里要包含申请人本人（你的学号和姓名）');

        if (minutes(end) - minutes(begin) > 120) throw new Error('一次最多预约连续 2 节（约 2 小时以内）');

        const room = (await space(ctx.services)).rooms.find((r) => r.id === roomId);
        if (!room) throw new Error('北大空间没有这个教室 id，先用 room-booking__rooms 查');
        if (room.minPeople && members.length < room.minPeople) throw new Error(`${room.building}${room.name} 至少 ${room.minPeople} 人起约，当前 ${members.length} 人`);
        if (room.capacity && members.length > room.capacity) throw new Error(`${room.building}${room.name} 最多容纳 ${room.capacity} 人，当前 ${members.length} 人`);
        await checkCanApply(ctx.services, room.applyHref);

        const taken = await schedule(ctx.services, roomId, begin.slice(0, 10)).catch(() => []);
        const clash = taken.find((s) => overlaps(begin, end, s));
        if (clash) throw new Error(`这个时段已被占用：${clash.begin} ~ ${clash.end}`);

        const verified: Student[] = [];
        for (const m of members) verified.push(await searchStudent(ctx.services, m.serial, m.name));
        const result = await submit(ctx.services, { roomId, begin, end, reason, participants: verified });
        if (!result.success) throw new Error(`预约失败：${result.message}`);
        return { ...result, room: `${room.building}${room.name}`, roomId, begin, end, participants: verified.map((p) => `${p.serial} ${p.name}`) };
      },
    }),
    cancel: defineTool({
      title: '取消研讨室预约',
      description: 'Cancel one of my reservations by its id (from room-booking__reservations).',
      input: z.object({ id: z.string().trim().regex(/^\d+$/, 'id 来自 room-booking__reservations') }),
      effect: 'write',
      execute: async ({ id }, ctx) => {
        const after = await cancel(ctx.services, id);
        return { cancelled: true, id, status: after?.status ?? '申请已取消' };
      },
    }),
    groups: defineTool({
      title: '参与人分组',
      description: 'Saved participant groups (name → members with student id and name).',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => loadGroups(ctx.kv),
    }),
    saveGroup: defineTool({
      title: '保存参与人分组',
      description: 'Save (or replace) a named participant group on this device, for reuse in room-booking__reserve. Members only as given by the user.',
      input: z.object({ name: z.string().trim().min(1).max(20), members: z.array(member).min(1).max(30) }),
      effect: 'write',
      execute: async ({ name, members }, ctx) => {
        const groups = await loadGroups(ctx.kv);
        groups[name] = members;
        await ctx.kv.set('groups', groups);
        return { saved: name, members: members.length };
      },
    }),
    deleteGroup: defineTool({
      title: '删除参与人分组',
      description: 'Delete a saved participant group.',
      input: z.object({ name: z.string().trim().min(1) }),
      effect: 'write',
      execute: async ({ name }, ctx) => {
        const groups = await loadGroups(ctx.kv);
        if (!(name in groups)) return { deleted: false, name };
        delete groups[name];
        await ctx.kv.set('groups', groups);
        return { deleted: true, name };
      },
    }),
  },
});
