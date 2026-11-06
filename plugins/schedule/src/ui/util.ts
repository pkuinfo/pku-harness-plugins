import { at, dayKey, formatClock, parts } from '@pku-harness/sdk';

/*
 * Wall-clock helpers in the app's clock zone (SDK `clock.ts`). `Date`s here are instants; their
 * year/month/day/hour are always read through `parts`, never the Date local getters. Values
 * from `DateTimeField` are treated the same way (the host's picker edits wall-clock time in the
 * clock zone).
 */

/** Midnight that starts the day of `d`. */
export const startOfDay = (d: Date) => {
  const p = parts(d.getTime());
  return new Date(at(p.year, p.month, p.day));
};
export const sameDay = (a: Date, b: Date) => dayKey(a.getTime()) === dayKey(b.getTime());
/** Midnight of the Monday of `d`'s week. */
export const mondayOf = (d: Date) => {
  const p = parts(d.getTime());
  return new Date(at(p.year, p.month, p.day - (p.weekday - 1)));
};
/** Midnight `n` days after `d`'s day. */
export const addDays = (d: Date, n: number) => {
  const p = parts(d.getTime());
  return new Date(at(p.year, p.month, p.day + n));
};
export const clock = (d: Date) => formatClock(d);
/** The instant at `hour:minute` on `d`'s day (hour 24+ rolls into the next day). */
export const dayAt = (d: Date | number, hour: number, minute = 0) => {
  const p = parts(+d);
  return at(p.year, p.month, p.day, hour, minute);
};
/** Today's date at `hh:mm` (for time-only pickers). */
export const timeToday = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(dayAt(Date.now(), h, m));
};
/** "HH:mm" of `d` (what a time-only picker chose). */
export const hhmmOf = (d: Date) => formatClock(d);
/** Day of month of `d` (1–31). */
export const dayOfMonth = (d: Date) => parts(d.getTime()).day;
/** Month of `d` (1–12). */
export const monthOf = (d: Date) => parts(d.getTime()).month;
/** Weekday of `d`, JS numbering (0 = Sunday … 6 = Saturday), as stored in courses and triggers. */
export const jsWeekday = (d: Date | number) => parts(+d).weekday % 7;
/** Midnight-relative minutes of `d` ("09:30" → 570). */
export const minuteOfDay = (d: Date) => {
  const p = parts(d.getTime());
  return p.hour * 60 + p.minute;
};

/** Modal form routes of this plugin. */
export const form = (screen: 'todo' | 'reminder' | 'course' | 'semester', params: Record<string, string> = {}) => {
  // Built by hand: Hermes' URLSearchParams is incomplete.
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `/m/schedule/${screen}${q ? `?${q}` : ''}`;
};
