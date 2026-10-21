import { LINES, STOPS, TRIPS, type DayType, type Stop, type Trip } from './data';

/** Pure timetable logic in Beijing time (UTC+8, no DST), independent of the device time zone. */

const BJ = 8 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');

export type BeijingTime = { date: string; weekday: number; minutes: number; text: string };

export function beijing(ms: number): BeijingTime {
  const d = new Date(ms + BJ);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { date, weekday: d.getUTCDay(), minutes, text: `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}

/** "YYYY-MM-DD HH:mm" (or "YYYY-MM-DDTHH:mm") read as Beijing time → epoch ms. */
export function parseBeijing(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - BJ;
  return beijing(ms).text === `${m[1]}-${m[2]}-${m[3]} ${pad(Number(m[4]))}:${m[5]}` ? ms : null;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Saturday and Sunday use the 周末及节假日 table; public holidays must be passed explicitly. */
export const dayTypeOf = (weekday: number): DayType => (weekday === 0 || weekday === 6 ? 'holiday' : 'weekday');

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export type Area = Stop['area'];

const ALIASES: [RegExp, Area][] = [
  [/200\s*号|二百号|昌平200|200/, 'lab200'],
  [/新燕园|昌平|新校区|马池口|xinyanyuan|changping|new\s*campus/i, 'xinyanyuan'],
  [/北安河|16号线|十六号线|bei[’']?anhe|line\s*16/i, 'beianhe'],
  [/阳坊|yangfang/i, 'yangfang'],
  [/肖家河|农大南路|xiaojiahe/i, 'xiaojiahe'],
  [/西二旗|上地|xi[’']?erqi|shangdi/i, 'xierqi'],
  [/燕园|本部|校本部|海淀|主校区|金光|yanyuan|main\s*campus|haidian/i, 'yanyuan'],
];

/** User wording → stop area ("本部", "昌平", "北安河地铁"…); null when unknown. */
export function resolvePlace(text: string | undefined): Area | null {
  if (!text?.trim()) return null;
  for (const [re, area] of ALIASES) if (re.test(text)) return area;
  return null;
}

export const AREA_NAMES: Record<Area, string> = {
  yanyuan: '燕园校区',
  xinyanyuan: '新燕园校区',
  lab200: '200号校园',
  xiaojiahe: '肖家河',
  xierqi: '西二旗',
  yangfang: '阳坊',
  beianhe: '地铁北安河站',
};

/** English station names (official / pinyin), for the local /shuttle answer in English. */
export const AREA_NAMES_EN: Record<Area, string> = {
  yanyuan: 'Yanyuan (main campus)',
  xinyanyuan: 'Xinyanyuan (Changping)',
  lab200: 'Campus 200',
  xiaojiahe: 'Xiaojiahe',
  xierqi: 'Xi’erqi',
  yangfang: 'Yangfang',
  beianhe: 'Bei’anhe metro station',
};

const WEEKDAY_EN: Record<string, string> = { 周日: 'Sun', 周一: 'Mon', 周二: 'Tue', 周三: 'Wed', 周四: 'Thu', 周五: 'Fri', 周六: 'Sat' };

/** "in 12 min" / "in 1 h 5 min" / "Mon 08:00": the English counterpart of formatIn. */
export function formatInEn(dep: Departure, today: string): string {
  if (dep.date !== today) return `${WEEKDAY_EN[dep.weekday] ?? dep.weekday} ${dep.time}`;
  if (dep.inMinutes < 1) return 'leaving now';
  if (dep.inMinutes < 60) return `in ${dep.inMinutes} min`;
  const h = Math.floor(dep.inMinutes / 60);
  const m = dep.inMinutes % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

export type Departure = {
  date: string;
  weekday: string;
  /** HH:mm at the boarding stop; for intermediate stops without a published time, the origin's departure. */
  time: string;
  /** true = boarding stop has no published time; the bus leaves its origin at `time` and passes later. */
  approx?: true;
  inMinutes: number;
  from: string;
  boardAt: string;
  to: string;
  route: string;
  line: string;
};

const DAY = 86_400_000;

/** Boarding index i and alighting index j of `trip` for from → to (null filters = origin / terminus). */
function legs(trip: Trip, from: Area | null, to: Area | null) {
  const area = (k: number) => STOPS[trip.stops[k].stop].area;
  const i = from ? trip.stops.findIndex((_, k) => area(k) === from) : 0;
  if (i < 0 || i === trip.stops.length - 1) return null;
  if (!to) return { i, j: trip.stops.length - 1 };
  for (let j = i + 1; j < trip.stops.length; j++) if (area(j) === to) return { i, j };
  return null;
}

/**
 * Next departures after `nowMs` (Beijing time) from → to. Searches today and the next `days - 1`
 * days. `dayType` overrides the table for the first day only (holidays / vacation).
 */
export function nextDepartures(opts: { from: Area | null; to: Area | null; nowMs: number; count?: number; dayType?: DayType; days?: number; lines?: Trip['line'][] }): Departure[] {
  const { from, to, nowMs, count = 3, days = 2 } = opts;
  const out: Departure[] = [];
  const now = beijing(nowMs);
  for (let d = 0; d < days && out.length < count; d++) {
    const day = beijing(nowMs + d * DAY);
    const type = d === 0 && opts.dayType ? opts.dayType : dayTypeOf(day.weekday);
    const found: (Departure & { sort: number })[] = [];
    for (const trip of TRIPS) {
      if (trip.days !== type || (opts.lines && !opts.lines.includes(trip.line))) continue;
      const leg = legs(trip, from, to);
      if (!leg) continue;
      const board = trip.stops[leg.i];
      const time = board.time ?? trip.stops.slice(0, leg.i + 1).reverse().find((s) => s.time)?.time;
      if (!time) continue;
      const mins = toMin(time);
      if (d === 0 && mins < now.minutes) continue;
      found.push({
        sort: mins,
        date: day.date,
        weekday: DAY_NAMES[day.weekday],
        time,
        ...(board.time ? {} : { approx: true as const }),
        inMinutes: d * 1440 + mins - now.minutes,
        from: STOPS[board.stop].name,
        boardAt: STOPS[board.stop].where,
        to: STOPS[trip.stops[leg.j].stop].name,
        route: trip.stops.map((s) => STOPS[s.stop].name).join('→'),
        line: LINES[trip.line].name,
      });
    }
    found.sort((a, b) => a.sort - b.sort);
    for (const { sort: _sort, ...dep } of found) {
      if (out.length >= count) break;
      out.push(dep);
    }
  }
  return out;
}

/** Whole table of one day type, grouped by direction, for display. */
export function timetable(dayType: DayType, line?: Trip['line']) {
  const groups = new Map<string, { direction: string; line: string; runs: { time: string; route: string }[] }>();
  for (const trip of TRIPS) {
    if (trip.days !== dayType || (line && trip.line !== line)) continue;
    const first = STOPS[trip.stops[0].stop];
    const last = STOPS[trip.stops.at(-1)!.stop];
    const direction = `${AREA_NAMES[first.area]}→${AREA_NAMES[last.area]}`;
    const key = `${trip.line}:${direction}`;
    const g = groups.get(key) ?? { direction, line: LINES[trip.line].name, runs: [] };
    g.runs.push({
      time: trip.stops[0].time!,
      route: trip.stops.map((s) => `${STOPS[s.stop].name}${s.time && s !== trip.stops[0] ? `(${s.time})` : ''}`).join('→'),
    });
    groups.set(key, g);
  }
  for (const g of groups.values()) g.runs.sort((a, b) => a.time.localeCompare(b.time));
  return [...groups.values()];
}

/** "8 分钟后" / "1 小时 5 分钟后" / "明天 07:00". */
export function formatIn(dep: Departure, today: string): string {
  if (dep.date !== today) return `${dep.weekday} ${dep.time}`;
  if (dep.inMinutes < 1) return '即将发车';
  if (dep.inMinutes < 60) return `${dep.inMinutes} 分钟后`;
  const h = Math.floor(dep.inMinutes / 60);
  const m = dep.inMinutes % 60;
  return m ? `${h} 小时 ${m} 分钟后` : `${h} 小时后`;
}

/** Split "燕园到新燕园" / "从昌平回本部" / "新燕园 北安河" / "Yanyuan to Changping" into from / to. */
export function parseRoute(input: string): { from: Area | null; to: Area | null } {
  const s = input.trim();
  if (!s) return { from: null, to: null };
  const en = /^(?:from\s+)?(.+?)\s+to\s+(.+)$/i.exec(s);
  if (en) return { from: resolvePlace(en[1]), to: resolvePlace(en[2]) };
  if (/^to\s+/i.test(s)) return { from: null, to: resolvePlace(s.replace(/^to\s+/i, '')) };
  const m = /^(?:从)?(.+?)\s*(?:到|去|至|回|→|->|—|-|\s)\s*(.+)$/.exec(s);
  if (m) return { from: resolvePlace(m[1]), to: resolvePlace(m[2]) };
  if (/^(?:去|到|回)/.test(s)) return { from: null, to: resolvePlace(s.slice(1)) };
  return { from: resolvePlace(s), to: null };
}

/** Local `/校车` answer: computed on the phone, never sent to the model. */
export function quickAnswer(input: string, nowMs = Date.now(), locale: 'zh-Hans' | 'en' = 'zh-Hans'): string {
  const now = beijing(nowMs);
  const asked = parseRoute(input);
  const pairs: { from: Area | null; to: Area | null }[] =
    asked.from || asked.to ? [asked] : [{ from: 'yanyuan', to: 'xinyanyuan' }, { from: 'xinyanyuan', to: 'yanyuan' }];
  const en = locale === 'en';
  const lines = pairs.map(({ from, to }) => {
    const deps = nextDepartures({ from, to, nowMs, count: 3 });
    if (en) {
      const title = `${from ? AREA_NAMES_EN[from] : 'Any stop'} → ${to ? AREA_NAMES_EN[to] : 'any stop'}`;
      if (!deps.length) return `${title}: no buses today or tomorrow`;
      return `${title}: ${deps.map((d) => `${d.date === now.date ? '' : `${WEEKDAY_EN[d.weekday] ?? d.weekday} `}${d.time}${d.approx ? ' (departs)' : ''}`).join(', ')} (${formatInEn(deps[0], now.date)})`;
    }
    const title = `${from ? AREA_NAMES[from] : '任意站'} → ${to ? AREA_NAMES[to] : '任意站'}`;
    if (!deps.length) return `${title}：今明两天没有班次`;
    return `${title}：${deps.map((d) => `${d.date === now.date ? '' : `${d.weekday} `}${d.time}${d.approx ? '（始发）' : ''}`).join('、')}（${formatIn(deps[0], now.date)}）`;
  });
  const weekday = dayTypeOf(now.weekday) === 'weekday';
  if (en) {
    return `${lines.join('\n')}\nUsing the ${weekday ? 'weekday' : 'weekend and holiday'} timetable; public holidays and vacations follow the weekend table. Commuter buses must be booked in the portal (新校区班车预约).`;
  }
  return `${lines.join('\n')}\n按${weekday ? '工作日' : '周末及节假日'}时刻表；法定节假日、寒暑假按周末及节假日表。通勤班车需在门户「新校区班车预约」预约。`;
}
