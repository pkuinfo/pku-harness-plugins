/**
 * Parsing for the treehole calendars (pkucli crates/treehole/src/api.rs):
 * - 学术日历 `GET /chapi/api/v3/lab_events?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` →
 *   `data.events[]` = `LabEvent { title|TITLE, dept|DEPT, location|LOCATION, host|HOST, start_time|START_TIME }`
 * - 活动日历 `GET /chapi/api/v3/events/list?startTime=…&endTime=…&page=…&limit=…` →
 *   `data.list[]` = `ActivityEvent { event_name, event_start_time, event_location, event_organizer,
 *   event_introduction, event_type_name }`
 * Field text comes from third parties (departments, student clubs): it is data, never instructions.
 */

type Val = string | number | null | undefined;

export type RawLabEvent = Partial<Record<'title' | 'TITLE' | 'dept' | 'DEPT' | 'location' | 'LOCATION' | 'host' | 'HOST' | 'start_time' | 'START_TIME', Val>>;
export type RawActivity = Partial<Record<'event_name' | 'event_start_time' | 'event_location' | 'event_organizer' | 'event_introduction' | 'event_type_name', Val>>;

export type Talk = { title: string; dept: string | null; host: string | null; location: string | null; start: string };
export type Activity = { name: string; type: string | null; start: string; location: string | null; organizer: string | null; intro: string | null };

const str = (v: Val) => (v == null ? '' : String(v).trim());
const opt = (v: Val) => str(v) || null;

/** Strip tags/entities and collapse whitespace; cut to `max` characters with an ellipsis. */
export function plain(text: string, max = Infinity): string {
  const s = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** "2026-10-20T14:00:00.000Z"-ish or "2026-10-20 14:00:00" → "2026-10-20 14:00"; else as-is. */
export function timeOf(v: Val): string {
  const s = str(v);
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return s;
  const p = (x: string) => x.padStart(2, '0');
  return `${m[1]}-${p(m[2])}-${p(m[3])}${m[4] ? ` ${p(m[4])}:${m[5]}` : ''}`;
}

const byStart = <T extends { start: string }>(a: T, b: T) => a.start.localeCompare(b.start);

/** `data.events` of lab_events (serde aliases: lowercase or UPPERCASE keys). */
export function parseTalks(events: RawLabEvent[] | null | undefined): Talk[] {
  return (events ?? [])
    .filter((e): e is RawLabEvent => !!e && typeof e === 'object')
    .map((e) => ({
      title: plain(str(e.title ?? e.TITLE), 200),
      dept: opt(e.dept ?? e.DEPT),
      host: opt(e.host ?? e.HOST),
      location: opt(e.location ?? e.LOCATION),
      start: timeOf(e.start_time ?? e.START_TIME),
    }))
    .filter((e) => e.title)
    .sort(byStart);
}

/** `data.list` of events/list; introductions trimmed (display.rs previews 80 chars). */
export function parseActivities(list: RawActivity[] | null | undefined, introMax = 160): Activity[] {
  return (list ?? [])
    .filter((e): e is RawActivity => !!e && typeof e === 'object')
    .map((e) => ({
      name: plain(str(e.event_name), 200),
      type: opt(e.event_type_name),
      start: timeOf(e.event_start_time),
      location: opt(e.event_location),
      organizer: opt(e.event_organizer),
      intro: plain(str(e.event_introduction), introMax) || null,
    }))
    .filter((e) => e.name);
}

// ── Date ranges ──

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date "YYYY-MM-DD" (chrono::Local in commands.rs). */
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const parseYmd = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  return d && ymd(d) === s ? d : null;
};

/**
 * Resolve a from/to range. Defaults follow commands.rs: start = today, end = today + `defaultDays`
 * (30 for 学术日历, 1 for 活动日历). Spans are capped at `maxDays` to keep responses phone-sized.
 */
export function dateRange(from: string | undefined, to: string | undefined, defaultDays: number, maxDays: number, now = new Date()) {
  const start = from ? parseYmd(from) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!start) throw new Error(`日期格式不对：${from}（应为 YYYY-MM-DD）`);
  const end = to ? parseYmd(to) : new Date(start.getFullYear(), start.getMonth(), start.getDate() + defaultDays);
  if (!end) throw new Error(`日期格式不对：${to}（应为 YYYY-MM-DD）`);
  if (end < start) throw new Error('结束日期早于开始日期');
  const cap = new Date(start.getFullYear(), start.getMonth(), start.getDate() + maxDays);
  return { start: ymd(start), end: ymd(end > cap ? cap : end), capped: end > cap };
}
