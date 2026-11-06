/**
 * The one wall clock every layer uses (agent, scheduler, to-dos, timetable, ledger, Schedule UI).
 *
 * "Today", "9:00", "Monday", "this month" are wall-clock ideas that depend on a time zone. If
 * one layer asks the JS `Date` local methods and another uses a different zone, they disagree
 * about which day an instant falls on. So all wall-clock date math goes through this module,
 * and the app's Settings choice (Auto = the device's zone, or a fixed zone such as
 * Asia/Shanghai for students abroad) moves every layer at once via {@link setClockZone}.
 *
 * Instants stay epoch milliseconds everywhere; only the conversion between an instant and its
 * wall-clock fields (year, month, day, hour, …) depends on the zone.
 *
 * - `'device'` (the default) is exactly the JS `Date` local methods (`getHours`,
 *   `new Date(y, m, d)`, …), including the device's DST rules.
 * - A fixed zone is a constant UTC offset; the arithmetic is done in UTC with that offset.
 *   No `Intl` / `Temporal` (Hermes support is unreliable), so a fixed zone has no DST: pass the
 *   offset in effect (Asia/Shanghai = +480).
 *
 * Not for campus facts that are Beijing time regardless of the user (e.g. the plugin language's
 * stdlib dates, campus-card records): those stay pinned to +08:00 where they are parsed.
 */

/**
 * Which zone wall-clock math uses. `'device'` = the phone's own zone (JS `Date` local methods).
 * Otherwise a fixed UTC offset in minutes (east positive: Asia/Shanghai = 480,
 * America/Los_Angeles in winter = -480, Asia/Kathmandu = 345); `id` is the IANA name, for
 * display only.
 */
export type ClockZone = 'device' | { id: string; offsetMinutes: number };

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

let zone: ClockZone = 'device';
const listeners = new Set<() => void>();

/** Set the zone for all wall-clock math. The app calls this at boot and when the setting changes. */
export function setClockZone(next: ClockZone): void {
  if (next !== 'device' && !Number.isFinite(next.offsetMinutes)) throw new Error(`invalid clock zone offset: ${next.offsetMinutes}`);
  const same =
    next === zone || (next !== 'device' && zone !== 'device' && next.id === zone.id && next.offsetMinutes === zone.offsetMinutes);
  zone = next === 'device' ? 'device' : { id: next.id, offsetMinutes: next.offsetMinutes };
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
  const d = new Date(ms + zone.offsetMinutes * MINUTE);
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
 * Under 'device', a time skipped or repeated by a DST change resolves the way `Date` does.
 */
export function at(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  if (zone === 'device') return new Date(year, month - 1, day, hour, minute, second).getTime();
  return Date.UTC(year, month - 1, day, hour, minute, second) - zone.offsetMinutes * MINUTE;
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
