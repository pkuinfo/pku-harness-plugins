import { formatTime } from '@pku-harness/sdk';

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
export const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const clock = (d: Date) => formatTime(d.getHours(), d.getMinutes());

/** Modal form routes of this plugin. */
export const form = (screen: 'todo' | 'reminder' | 'course' | 'semester', params: Record<string, string> = {}) => {
  // Built by hand: Hermes' URLSearchParams is incomplete.
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `/m/schedule/${screen}${q ? `?${q}` : ''}`;
};
