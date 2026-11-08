import { expect, test } from 'bun:test';
import { indexApps } from './app-index';

const app = (label: string, packageName = label) => ({ label, packageName });

test('indexes and sorts names without mutating the installed-app list', () => {
  const apps = [app('Settings'), app('Camera'), app('Chrome'), app('École'), app('123'), app('微信')];
  const before = [...apps];
  const groups = indexApps(apps);
  expect(groups.map((g) => g.letter)).toEqual(['C', 'E', 'S', '#']);
  expect(groups[0]?.apps.map((a) => a.label)).toEqual(['Camera', 'Chrome']);
  expect(groups.at(-1)?.apps).toHaveLength(2);
  expect(apps).toEqual(before);
});

test('handles empty names, whitespace and duplicate labels deterministically', () => {
  expect(indexApps([])).toEqual([]);
  expect(indexApps([app(''), app('  browser'), app('Browser', 'b'), app('Browser', 'a')]).map((g) => g.letter)).toEqual(['B', '#']);
  expect(indexApps([app('Browser', 'b'), app('Browser', 'a')])[0]?.apps.map((a) => a.packageName)).toEqual(['a', 'b']);
});
