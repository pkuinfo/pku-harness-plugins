import { parse, type HTMLElement, type Node, TextNode } from 'node-html-parser';

/**
 * 北大空间 (bdkj.pku.edu.cn) parsing, ported from pkucli crates/bdkj/src/api.rs. Pure: JSON / HTML
 * in, data out. Field names follow the site's JSON (`seatingCapacity`, `beginTime`, …).
 */

/** Building ids hard-coded in the site's pages (api.rs BUILDING_*). */
export const BUILDINGS = {
  二教: '924128798427975680',
  四教: '924128697978589184',
  地学: '924129024664539136',
} as const;
export type Building = keyof typeof BUILDINGS;

/** api.rs building_id: name, pinyin or building number. */
export function buildingId(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (['二教', 'erjiao', '02', '2'].includes(n)) return BUILDINGS.二教;
  if (['四教', 'sijiao', '04', '4'].includes(n)) return BUILDINGS.四教;
  if (['地学', 'dixue', '09', '9', '地学楼'].includes(n)) return BUILDINGS.地学;
  return null;
}

export type Room = { id: string; code: string; name: string; capacity: number | null; popularity: string; bookable: boolean; locked: boolean };
export type BookedSlot = { id: string; begin: string; end: string; intervals: string };
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

/** POST /room/classRoom (api.rs list_rooms): a JSON array of rooms. */
export function parseRooms(body: string): Room[] {
  const list = json<unknown>(body, '教室列表');
  if (!Array.isArray(list)) throw new Error('教室列表格式不对');
  return list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && r.id != null && r.name != null)
    .map((r) => {
      const cap = Number.parseInt(str(r.seatingCapacity), 10);
      return {
        id: str(r.id),
        code: str(r.code),
        name: str(r.name),
        capacity: Number.isFinite(cap) ? cap : null,
        popularity: str(r.popularity),
        bookable: r.bookable === true,
        locked: Number(r.locked ?? 0) !== 0,
      };
    });
}

/** POST /classRoom/historyTime (api.rs history_time): slots already taken. */
export function parseHistory(body: string): BookedSlot[] {
  const list = json<unknown>(body, '已预约时段');
  if (!Array.isArray(list)) throw new Error('已预约时段格式不对');
  return list
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object' && h.beginTime != null && h.endTime != null)
    .map((h) => ({ id: str(h.id), begin: str(h.beginTime), end: str(h.endTime), intervals: str(h.intervals) }));
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

/** GET /classRoom (api.rs parse_applications): rows under `div#results > div.row`. */
export function parseApplications(html: string): Application[] {
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
