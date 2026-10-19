import { parse, type HTMLElement, type Node, TextNode } from 'node-html-parser';

/**
 * 北大空间 (bdkj.pku.edu.cn) parsing. Pure: JSON / HTML in, data out. The site was redesigned in
 * 2026-10 (rooms now come from the /space page, availability from /space/schedule); the apply /
 * cancel / student-check parts are still ported from pkucli crates/bdkj/src/api.rs.
 */

/** Pinyin / number aliases for the three buildings the site lists (api.rs building_id). */
const BUILDING_ALIASES: Record<string, string[]> = {
  二教: ['erjiao', '二教学楼', '第二教学楼'],
  四教: ['sijiao', '四教学楼', '第四教学楼'],
  地学: ['dixue', '地学楼'],
};

export type Building = { id: string; name: string; code: string; bookable: number | null };
export type Room = {
  id: string;
  name: string;
  code: string;
  buildingId: string;
  building: string;
  floor: number | null;
  capacity: number | null;
  minPeople: number | null;
  /** Door state as printed on the card (关门 / 开门 / 常开 …); '' when the card has none. */
  door: string;
  /** Screen state as printed on the card (正常 …). */
  screen: string;
  /** Raw /space/lockStatus code (0 | 1 | 2), informative only: its mapping is unverified. */
  lockCode?: number;
  /** href of the card's 去申请 button, when the markup has one. */
  applyHref?: string;
};
export type BookedSlot = { begin: string; end: string };
export type Student = { id: string; serial: string; name: string };
export type Application = {
  id: string;
  room: string;
  status: string;
  applicant: string;
  appliedAt: string;
  time: string;
  reason: string;
  participants: string[];
  canCancel: boolean;
};

function json<T>(body: string, what: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    // An HTML page here usually means the campus network or session is missing.
    throw new Error(`${what}返回的不是数据（北大空间可能暂时不可用）`);
  }
}

const str = (v: unknown) => (v == null ? '' : String(v));
const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const int = (s: string | undefined) => {
  const n = Number.parseInt(/\d+/.exec(s ?? '')?.[0] ?? '', 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * GET /space (2026 redesign): building panels `[data-building-id]` (title, "(02)" code,
 * "共 <b>10</b> 间可预约") and room cards `.sp-card[data-room-id]` (name, 5-digit code, feature
 * list 楼层 / 可容纳 N 人 / 至少 N 人起约, device chips with `data-dev-kind`).
 */
export function parseSpace(html: string): { buildings: Building[]; rooms: Room[] } {
  const dom = parse(html);
  const buildings: Building[] = [];
  for (const el of dom.querySelectorAll('[data-building-id]') as HTMLElement[]) {
    const id = el.getAttribute('data-building-id') ?? '';
    const name = clean(el.querySelector('.cr-panel-title')?.text);
    if (!id || !name || buildings.some((b) => b.id === id)) continue;
    const code = /\d+/.exec(el.querySelector('.sp-building-code')?.text ?? '')?.[0] ?? '';
    const count = el.querySelector('.cr-panel-count');
    buildings.push({ id, name, code, bookable: int(count?.querySelector('b')?.text ?? count?.text) });
  }

  const rooms: Room[] = [];
  for (const card of dom.querySelectorAll('.sp-card[data-room-id]') as HTMLElement[]) {
    const id = card.getAttribute('data-room-id') ?? '';
    if (!id || rooms.some((r) => r.id === id)) continue;
    const name = clean(card.querySelector('.cr-room-name')?.text) || clean(card.getAttribute('data-room-name'));
    const code = clean(card.querySelector('.sp-code')?.text);
    // The card sits inside its building panel; else match the code prefix ("02514" → 02).
    let el: HTMLElement | null = card;
    while (el && !el.getAttribute?.('data-building-id')) el = el.parentNode as HTMLElement | null;
    const building = buildings.find((b) => b.id === el?.getAttribute('data-building-id')) ?? buildings.find((b) => b.code && code.startsWith(b.code));

    let floor: number | null = null;
    let capacity: number | null = null;
    let minPeople: number | null = null;
    for (const li of card.querySelectorAll('.sp-features li') as HTMLElement[]) {
      const t = clean(li.text);
      if (/可容纳/.test(t)) capacity = int(t);
      else if (/起约|至少/.test(t)) minPeople = int(t);
      else if (/层|楼/.test(t)) floor = int(t);
    }
    const dev = (kind: string) => clean(card.querySelector(`[data-dev-kind="${kind}"] .sp-dev-state`)?.text);
    const href = card.querySelector('a.sp-btn-apply')?.getAttribute('href');
    rooms.push({
      id,
      name,
      code,
      buildingId: building?.id ?? '',
      building: building?.name ?? '',
      floor,
      capacity,
      minPeople,
      door: dev('door'),
      screen: dev('screen'),
      ...(href && !/^(#|javascript:)/i.test(href) ? { applyHref: href } : {}),
    });
  }
  return { buildings, rooms };
}

/** A building by name, code ("02" / "2") or pinyin. */
export function matchBuilding(query: string, buildings: Building[]): Building | null {
  const q = query.trim().toLowerCase().replace(/楼$/, '');
  if (!q) return null;
  return (
    buildings.find((b) => {
      const name = b.name.toLowerCase();
      const aliases = Object.entries(BUILDING_ALIASES).find(([k]) => name.includes(k.toLowerCase()))?.[1] ?? [];
      return name === q || name.replace(/楼$/, '') === q || (b.code && Number(b.code) === Number(q)) || aliases.includes(q) || aliases.includes(query.trim());
    }) ?? null
  );
}

/** GET /space/lockStatus: `{ "<roomId>": 0|1|2 }`. Anything malformed yields {}. */
export function parseLockStatus(body: string): Record<string, number> {
  try {
    const map = JSON.parse(body) as unknown;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(map)) if (typeof v === 'number') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** GET /space/schedule?roomId&startDate: taken slots for the week from startDate. */
export function parseSchedule(body: string): BookedSlot[] {
  const list = json<unknown>(body, '已预约时段');
  if (!Array.isArray(list)) throw new Error('已预约时段格式不对');
  return list
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object' && h.beginTime != null && h.endTime != null)
    .map((h) => ({ begin: str(h.beginTime), end: str(h.endTime) }));
}

/**
 * The bookable periods of a day: 13 periods of 50 minutes, 08:00–22:30 (the site's landing
 * page). Periods 1–12 follow the PKU class timetable (a taken slot 20:40–21:30 = period 12),
 * 13 is 21:40–22:30. Free/taken is decided by overlap, so a slightly off grid never shows a
 * taken period as free.
 */
export const PERIODS: readonly [string, string][] = [
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
  ['21:40', '22:30'],
];

export type DaySlots = { date: string; free: { period: number; begin: string; end: string }[]; taken: BookedSlot[] };

/**
 * Free periods per day for `dates` ("YYYY-MM-DD"), given the taken slots. Periods that already
 * started before `now` ("YYYY-MM-DD HH:MM:SS", optional) are not offered.
 */
export function freeSlots(dates: string[], taken: BookedSlot[], now?: string): DaySlots[] {
  return dates.map((date) => {
    const dayTaken = taken.filter((s) => s.begin.startsWith(date));
    const free = PERIODS.map(([b, e], i) => ({ period: i + 1, begin: `${date} ${b}:00`, end: `${date} ${e}:00` }))
      .filter((p) => !(now && p.begin < now))
      .filter((p) => !dayTaken.some((s) => overlaps(p.begin, p.end, s)))
      .map((p) => ({ period: p.period, begin: p.begin.slice(11, 16), end: p.end.slice(11, 16) }));
    return { date, free, taken: dayTaken };
  });
}

/** Whether a final URL is bdkj's 个人信息 page (an incomplete profile is sent there before applying). */
export function isProfilePage(finalUrl: string): boolean {
  const path = /^https?:\/\/[^/]+([^?#]*)/.exec(finalUrl)?.[1] ?? '';
  return path === '/personal' || (path.startsWith('/personal/') && !path.startsWith('/personal/user'));
}

/** True when the /classRoom page shows its empty state (暂无申请记录). */
export function isEmptyApplications(html: string): boolean {
  return /class="[^"]*\bcr-empty\b/.test(html) || html.includes('暂无申请记录');
}

/** POST /classRoom/seachStudent (api.rs search_student): `{ success, message, data }`. Contact fields are dropped. */
export function parseStudent(body: string): Student {
  const res = json<{ success?: boolean; message?: string; data?: Record<string, unknown> | null }>(body, '查询参与人');
  if (!res.success) throw new Error(res.message || '查无此人');
  const d = res.data;
  if (!d || d.id == null) throw new Error('查询参与人没有返回数据');
  return { id: str(d.id), serial: str(d.serial), name: str(d.name) };
}

/** api.rs extract_layer_msg: the text of the page's first `layer.msg("…")`. */
export function layerMsg(html: string): string | null {
  return /layer\.msg\(["']([^"']+)["']/.exec(html)?.[1] ?? null;
}

/**
 * api.rs submit_apply: success = handle/submit redirected to the /classRoom list; failure stays
 * on /classRoom/apply with a `layer.msg(...)` (the SKILL notes the URL is the reliable signal).
 */
export function submitOutcome(finalUrl: string, body: string): { success: boolean; message: string } {
  const path = (/^https?:\/\/[^/]+([^?#]*)/.exec(finalUrl)?.[1] ?? finalUrl).replace(/\/+$/, '');
  if (path === '/classRoom' || path.endsWith('/classRoom')) return { success: true, message: '预约提交成功' };
  return { success: false, message: layerMsg(body) ?? '北大空间没有接受这次预约' };
}

/** Text nodes joined with spaces, whitespace collapsed (scraper's `text().join(" ")`). */
function spacedText(node: Node): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n instanceof TextNode) parts.push(n.text);
    else for (const c of n.childNodes) walk(c);
  };
  walk(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeStatus(raw: string) {
  if (raw.includes('申请成功')) return '申请成功';
  if (raw.includes('已取消')) return '申请已取消';
  if (raw.includes('已结束')) return '已结束';
  return raw || '未知';
}

/**
 * GET /classRoom: `div#results` holds the records, or `div.cr-empty` (暂无申请记录). The 2026 row
 * markup is not known yet, so rows are still read the api.rs parse_applications way
 * (`div#results > div.row`).
 */
export function parseApplications(html: string): Application[] {
  if (isEmptyApplications(html)) return [];
  const dom = parse(html);
  const out: Application[] = [];
  for (const row of dom.querySelectorAll('div#results > div.row') as HTMLElement[]) {
    const raw = row.toString();
    const text = spacedText(row);
    const room = row.querySelector('h5')?.text.replace(/\s+/g, ' ').trim() ?? '';
    if (!room) continue;

    const id = /\/classRoom\/cancelApply\/(\d+)/.exec(raw)?.[1] ?? '';
    const status = normalizeStatus((/color-red"><strong>([^<]+)/.exec(raw)?.[1] ?? row.querySelector('.color-red strong')?.text ?? '').trim());
    const appliedAt = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(text)?.[1] ?? '';
    const time = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s*-\s*\d{2}:\d{2})/.exec(text)?.[1] ?? '';
    // "<name> 申请 <applied at>"
    const applicant = appliedAt ? (/(\S+)\s+申请$/.exec(text.split(appliedAt)[0].trimEnd())?.[1] ?? '') : '';
    const reason = /fa-comment-dots[^<]*<\/em>\s*([^<]+)/.exec(raw)?.[1]?.trim() ?? '';
    // Participants read "张三[ 未签到 ] 李四[ 已签到 ]": the token right before each "[".
    const participants = text
      .split(']')
      .map((seg) => {
        const at = seg.lastIndexOf('[');
        return at < 0 ? '' : (seg.slice(0, at).trim().split(' ').pop() ?? '');
      })
      .filter((n) => n && n !== '申请');

    out.push({ id, room, status, applicant, appliedAt, time, reason, participants, canCancel: !!id });
  }
  return out;
}

/**
 * "YYYY-MM-DD HH:MM[:SS]" (also "T" separated) → "YYYY-MM-DD HH:MM:SS", the format
 * handle/submit expects (lib.rs Reserve `--begin`). Returns null for anything else.
 */
export function normalizeTime(input: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const pad = (v: string) => v.padStart(2, '0');
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d) || Number(h) > 23) return null;
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${mi}:${s ?? '00'}`;
}

/** Form fields of the browser's step-4 submit (api.rs submit_apply), in order. */
export function submitForm(input: { roomId: string; begin: string; end: string; reason: string; participants: Student[] }): [string, string][] {
  const fields: [string, string][] = [
    ['id', ''],
    ['beginTime', input.begin],
    ['endTime', input.end],
    ['roomId', input.roomId],
    ['step', '3'],
    ['switchover', 'true'],
    ['reason', input.reason],
  ];
  input.participants.forEach((p, i) => {
    fields.push([`students[${i}].studentId`, p.id], [`students[${i}].serial`, p.serial], [`students[${i}].name`, p.name], [`students[${i}].sort`, String(i)]);
  });
  return fields;
}

export const encodeForm = (fields: [string, string][]) => fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

/** Whether [begin, end) overlaps a taken slot. Slots use "YYYY-MM-DD HH:MM[:SS]"; unknown formats never conflict. */
export function overlaps(begin: string, end: string, slot: BookedSlot): boolean {
  const b = normalizeTime(slot.begin);
  const e = normalizeTime(slot.end);
  if (!b || !e) return false;
  return begin < e && b < end;
}
