import type { PhoneApp } from '@pku-harness/sdk';

/** Latin initials (including accented names); other scripts and symbols remain searchable under #. */
export function indexApps(apps: PhoneApp[]) {
  const groups = new Map<string, PhoneApp[]>();
  for (const app of apps) {
    const initial = app.label.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').charAt(0).toUpperCase();
    const key = /^[A-Z]$/.test(initial) ? initial : '#';
    groups.set(key, [...(groups.get(key) ?? []), app]);
  }
  return [...groups].sort(([a], [b]) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))
    .map(([letter, items]) => ({ letter, apps: items.sort((a, b) => a.label.localeCompare(b.label) || a.packageName.localeCompare(b.packageName)) }));
}
