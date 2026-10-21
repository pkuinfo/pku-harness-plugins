import type { AppLocale } from './ui';

/**
 * Locale-aware date/time strings for plugin screens and widgets (docs/AGENT-HARNESS.md §8).
 * Hand-formatted, because Hermes' Intl ignores locales; the output matches the app's own
 * `src/utils/date.ts` so plugin UI reads like the rest of the app. Pure: pass `now` in tests.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;

const toDate = (d: Date | number) => (typeof d === 'number' ? new Date(d) : d);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Calendar days from `now` to `d` (0 = today, 1 = tomorrow, -1 = yesterday), DST-safe. */
export const dayDiff = (d: Date | number, now: Date | number = Date.now()) => Math.round((startOfDay(toDate(d)) - startOfDay(toDate(now))) / DAY);

/** Per-locale string table; `en` must have exactly the keys (and value types) of `zh-Hans`. */
export type Localized<T> = { 'zh-Hans': T; en: T };

/** Define a plugin's string table with `en` type-checked against `zh-Hans`. */
export const defineStrings = <T>(table: { 'zh-Hans': T; en: NoInfer<T> }): Localized<T> => table;

/** "21:04" (or "21:04:37" with seconds); same in both locales. */
export function formatClock(d: Date | number, seconds = false): string {
  const x = toDate(d);
  return `${pad(x.getHours())}:${pad(x.getMinutes())}${seconds ? `:${pad(x.getSeconds())}` : ''}`;
}

/** "周一" / "Mon". */
export function formatWeekday(d: Date | number, locale: AppLocale): string {
  const day = toDate(d).getDay();
  return locale === 'en' ? WEEKDAYS_EN[day] : `周${WEEKDAYS_ZH[day]}`;
}

/** Weekday by number (1 = Monday … 7 = Sunday, the timetable convention): "周一" / "Mon". */
export function weekdayName(weekday: number, locale: AppLocale): string {
  const day = ((weekday % 7) + 7) % 7;
  return locale === 'en' ? WEEKDAYS_EN[day] : `周${WEEKDAYS_ZH[day]}`;
}

/** "10月18日" / "Oct 18"; the year is added when it isn't the current one. */
export function formatLocalDate(d: Date | number, locale: AppLocale, now: Date | number = Date.now()): string {
  const x = toDate(d);
  const sameYear = x.getFullYear() === toDate(now).getFullYear();
  if (locale === 'en') return `${MONTHS_EN[x.getMonth()]} ${x.getDate()}${sameYear ? '' : `, ${x.getFullYear()}`}`;
  return `${sameYear ? '' : `${x.getFullYear()}年`}${x.getMonth() + 1}月${x.getDate()}日`;
}

/** "10月18日 21:04" / "Oct 18, 21:04". */
export function formatLocalDateTime(d: Date | number, locale: AppLocale, now: Date | number = Date.now()): string {
  const date = formatLocalDate(d, locale, now);
  return locale === 'en' ? `${date}, ${formatClock(d)}` : `${date} ${formatClock(d)}`;
}

/**
 * A past timestamp, relative: "刚刚" / "Just now", "3 分钟前" / "3 min ago", today "21:04",
 * "昨天 21:04" / "Yesterday 21:04", else the date and time. (Like `host.formatAgo`, in the
 * given locale.)
 */
export function formatRelative(ms: number, locale: AppLocale, now: number = Date.now()): string {
  const diff = now - ms;
  const en = locale === 'en';
  if (diff < 60_000) return en ? 'Just now' : '刚刚';
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return en ? `${m} min ago` : `${m} 分钟前`;
  }
  const days = dayDiff(ms, now);
  if (days === 0) return formatClock(ms);
  if (days === -1) return en ? `Yesterday ${formatClock(ms)}` : `昨天 ${formatClock(ms)}`;
  return formatLocalDateTime(ms, locale, now);
}

/**
 * A day near today: "今天" / "Today", "明天" / "Tomorrow", "昨天" / "Yesterday", within the
 * coming week the weekday, otherwise the date.
 */
export function formatDay(d: Date | number, locale: AppLocale, now: Date | number = Date.now()): string {
  const n = dayDiff(d, now);
  const en = locale === 'en';
  if (n === 0) return en ? 'Today' : '今天';
  if (n === 1) return en ? 'Tomorrow' : '明天';
  if (n === -1) return en ? 'Yesterday' : '昨天';
  if (n > 1 && n < 7) return formatWeekday(d, locale);
  return formatLocalDate(d, locale, now);
}

/**
 * Time left until a future moment, short: "3天5小时" / "3d 5h", "2小时10分" / "2h 10m",
 * "8分钟" / "8 min", under a minute "不到1分钟" / "<1 min". Past or zero → "已到" / "Now".
 */
export function formatCountdown(ms: number, locale: AppLocale): string {
  const en = locale === 'en';
  if (ms <= 0) return en ? 'Now' : '已到';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return en ? '<1 min' : '不到1分钟';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return en ? `${d}d${h ? ` ${h}h` : ''}` : `${d}天${h ? `${h}小时` : ''}`;
  if (h > 0) return en ? `${h}h${m ? ` ${m}m` : ''}` : `${h}小时${m ? `${m}分` : ''}`;
  return en ? `${m} min` : `${m}分钟`;
}

/** English plural for a count: plural(1, 'book') → "1 book", plural(3, 'book') → "3 books". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
