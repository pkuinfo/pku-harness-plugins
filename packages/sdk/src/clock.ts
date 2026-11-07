/**
 * The one wall clock every layer uses (agent, scheduler, to-dos, timetable, ledger, Schedule UI).
 *
 * "Today", "9:00", "Monday", "this month" are wall-clock ideas that depend on a time zone. If
 * one layer asks the JS `Date` local methods and another uses a different zone, they disagree
 * about which day an instant falls on. So all wall-clock date math goes through this module,
 * and the app's Settings choice (follow the system, or any zone the user picks) moves every
 * layer at once via {@link setClockZone}.
 *
 * Instants stay epoch milliseconds everywhere; only the conversion between an instant and its
 * wall-clock fields (year, month, day, hour, …) depends on the zone.
 *
 * - `'device'` (the default) is exactly the JS `Date` local methods (`getHours`,
 *   `new Date(y, m, d)`, …), including the device's DST rules.
 * - A named zone (`{ id: 'America/New_York' }`) takes its UTC offset at each instant from
 *   `Intl.DateTimeFormat`, so DST is exact (Hermes on Android resolves `timeZone` correctly;
 *   checked on device). Offsets are cached per 15 minutes, the finest step real zones change on.
 * - `offsetMinutes` is the fallback when the runtime's `Intl` doesn't know `id` (or has no
 *   `Intl`): a constant offset, no DST. When `Intl` knows `id`, the real offset wins.
 *
 * Not for campus facts that are Beijing time regardless of the user (e.g. the plugin language's
 * stdlib dates, campus-card records): those stay pinned to +08:00 where they are parsed.
 */

/**
 * Which zone wall-clock math uses. `'device'` = the phone's own zone (JS `Date` local methods).
 * Otherwise an IANA zone `id` (Asia/Shanghai, America/New_York, Australia/Lord_Howe, …) with an
 * optional fixed `offsetMinutes` fallback (east positive: Asia/Shanghai = 480,
 * Asia/Kathmandu = 345) for runtimes whose `Intl` can't resolve `id`.
 */
export type ClockZone = 'device' | { id: string; offsetMinutes?: number };

/** Weekday number, ISO style: 1 = Monday … 7 = Sunday (NOT JS `getDay`'s 0 = Sunday). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Wall-clock fields of an instant in the current zone. */
export type ClockParts = {
  year: number;
  /** 1–12 (NOT JS `getMonth`'s 0–11). */
  month: number;
  /** Day of month, 1–31. */
  day: number;
  /** 0–23. */
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday … 7 = Sunday (NOT JS `getDay`'s 0 = Sunday); `weekday % 7` gives the JS number. */
  weekday: IsoWeekday;
};

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Offsets only change on 15-minute boundaries in real zones, so one lookup per slot is exact. */
const SLOT = 15 * MINUTE;

type Named = Exclude<ClockZone, 'device'>;

/** `Intl.DateTimeFormat` for a zone id, or null when the runtime can't resolve it. Cached. */
const formatters = new Map<string, Intl.DateTimeFormat | null>();
function formatterFor(id: string): Intl.DateTimeFormat | null {
  if (!formatters.has(id)) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: id,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    } catch {
      f = null; // unknown id, or no Intl time-zone support
    }
    formatters.set(id, f);
  }
  return formatters.get(id) ?? null;
}

/** Whether this runtime can resolve `id` as a time zone (e.g. to validate a picker choice). */
export function isZoneId(id: string): boolean {
  return formatterFor(id) != null;
}

/** UTC offset (minutes, east positive) of `id` at instant `ms`, read through Intl. */
function intlOffset(f: Intl.DateTimeFormat, ms: number): number {
  const whole = ms - (((ms % 1000) + 1000) % 1000);
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(whole)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  // Some engines print midnight as hour 24 even with h23.
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUtc - whole) / MINUTE);
}

const offsetCache = new Map<string, Map<number, number>>();

/** UTC offset in minutes (east positive) of a named zone at instant `ms`. */
function offsetIn(z: Named, ms: number): number {
  const f = formatterFor(z.id);
  if (!f) return z.offsetMinutes ?? 0;
  let cache = offsetCache.get(z.id);
  if (!cache) offsetCache.set(z.id, (cache = new Map()));
  const slot = Math.floor(ms / SLOT);
  let off = cache.get(slot);
  if (off === undefined) {
    if (cache.size > 2048) cache.clear();
    off = intlOffset(f, ms);
    cache.set(slot, off);
  }
  return off;
}

/** UTC offset in minutes (east positive) of `z` at `ms`; for showing "UTC+9" next to a zone. */
export function zoneOffset(z: ClockZone, ms = Date.now()): number {
  return z === 'device' ? -new Date(ms).getTimezoneOffset() : offsetIn(z, ms);
}

let zone: ClockZone = 'device';
const listeners = new Set<() => void>();

/**
 * Set the zone for all wall-clock math. The app calls this at boot and when the setting changes.
 * Throws for a zone the runtime can't resolve that has no usable `offsetMinutes` fallback.
 */
export function setClockZone(next: ClockZone): void {
  if (next !== 'device') {
    if (next.offsetMinutes !== undefined && !Number.isFinite(next.offsetMinutes)) throw new Error(`invalid clock zone offset: ${next.offsetMinutes}`);
    if (next.offsetMinutes === undefined && !isZoneId(next.id)) throw new Error(`unknown time zone: ${next.id}`);
  }
  const same =
    next === zone || (next !== 'device' && zone !== 'device' && next.id === zone.id && next.offsetMinutes === zone.offsetMinutes);
  zone = next === 'device' ? 'device' : next.offsetMinutes === undefined ? { id: next.id } : { id: next.id, offsetMinutes: next.offsetMinutes };
  if (!same) for (const l of [...listeners]) l();
}

/** The zone currently in use. */
export function clockZone(): ClockZone {
  return zone;
}

/** Be told when the zone changes (so UI can re-render). Returns the unsubscribe function. */
export function subscribeClockZone(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Wall-clock fields of the instant `ms` in the current zone (see {@link ClockParts}). */
export function parts(ms: number): ClockParts {
  if (zone === 'device') {
    const d = new Date(ms);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      weekday: (d.getDay() || 7) as IsoWeekday,
    };
  }
  const d = new Date(ms + offsetIn(zone, ms) * MINUTE);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: (d.getUTCDay() || 7) as IsoWeekday,
  };
}

/**
 * The instant of a wall-clock time in the current zone. `month` is 1–12. Out-of-range fields
 * roll over like `new Date(y, m - 1, d, h, mi, s)`: day 0 = last day of the previous month,
 * day 32 = into the next month, month 13 = January of the next year, hour 24 = next midnight.
 * A time skipped or repeated by a DST change resolves the way `Date` does, in every zone: a
 * skipped time (02:30 on a spring-forward night) moves forward by the gap, and a repeated one
 * (01:30 on a fall-back night) is its first, earlier occurrence.
 */
export function at(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  if (zone === 'device') return new Date(year, month - 1, day, hour, minute, second).getTime();
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  // The offsets around this wall time (real zones change at most once within a day).
  const before = offsetIn(zone, local - DAY);
  const after = offsetIn(zone, local + DAY);
  let best: number | null = null;
  for (const off of before === after ? [before] : [before, after]) {
    const t = local - off * MINUTE;
    // Valid when the zone really is on that offset at t; keep the earliest (repeated hour).
    if (offsetIn(zone, t) === off && (best == null || t < best)) best = t;
  }
  // No valid reading: the wall time was skipped, so read it with the offset before the jump.
  return best ?? local - before * MINUTE;
}

/** Midnight that starts the wall-clock day containing `ms`. */
export function startOfDay(ms: number): number {
  const p = parts(ms);
  return at(p.year, p.month, p.day);
}

/** The same wall-clock time `n` calendar days later (negative = earlier); milliseconds are kept. */
export function addDays(ms: number, n: number): number {
  const p = parts(ms);
  return at(p.year, p.month, p.day + n, p.hour, p.minute, p.second) + (((ms % 1000) + 1000) % 1000);
}

/** The wall-clock date of `ms` as 'YYYY-MM-DD'. */
export function dayKey(ms: number): string {
  const p = parts(ms);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Days in `month` (1–12) of `year`, leap years included. Zone-independent. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
