import type { PhoneApp } from '@pku-harness/sdk';

/** What an app sorts and indexes by: the native sort key (pinyin for Chinese names) when present, else its label. */
const key = (app: PhoneApp) => (app.sortKey ?? app.label).trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A–Z by Latin initial (Chinese names by pinyin); digits, symbols and untransliterated scripts go under #. */
export function indexApps(apps: PhoneApp[]) {
  const groups = new Map<string, PhoneApp[]>();
  for (const app of apps) {
    const initial = key(app).charAt(0).toUpperCase();
    const letter = /^[A-Z]$/.test(initial) ? initial : '#';
    groups.set(letter, [...(groups.get(letter) ?? []), app]);
  }
  return [...groups].sort(([a], [b]) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))
    .map(([letter, items]) => ({ letter, apps: items.sort((a, b) => key(a).localeCompare(key(b)) || a.label.localeCompare(b.label) || a.packageName.localeCompare(b.packageName)) }));
}
