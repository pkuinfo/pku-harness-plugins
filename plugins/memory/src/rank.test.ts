import { describe, expect, test } from 'bun:test';

import { bySnapshotOrder, findSimilar, rankForQuery, score, selectSnapshot, similarity, tokens } from './rank';
import { mem, now } from './test-fixtures';

describe('tokens', () => {
  test('CJK bigrams and latin words', () => {
    expect([...tokens('我住在燕园')]).toEqual(['我住', '住在', '在燕', '燕园']);
    expect(tokens('用 DeepSeek V4').has('deepseek')).toBe(true);
    expect(tokens('a 1').size).toBe(0);
  });
});

describe('snapshot order', () => {
  const list = [
    mem('c', '用户每周三晚上有社团活动', { kind: 'routine', createdAt: 3 }),
    mem('b', '用户喜欢在农园食堂吃午饭', { kind: 'preference', createdAt: 5 }),
    mem('a', '用户是信息科学技术学院 2024 级本科生', { createdAt: 1 }),
    mem('d', '提醒请提前 15 分钟', { kind: 'preference', pinned: true, createdAt: 9 }),
    mem('e', '用户住在 32 楼', { createdAt: 1 }),
    mem('p', '待确认的记忆', { status: 'pending', pinned: true }),
  ];

  test('pinned, then kind, then oldest, then id; never by query', () => {
    expect(selectSnapshot(list).map((m) => m.id)).toEqual(['d', 'b', 'a', 'e', 'c']);
    expect([...list].reverse().sort(bySnapshotOrder).map((m) => m.id)).toEqual([...list].sort(bySnapshotOrder).map((m) => m.id));
  });

  test('pending memories are never in the snapshot', () => {
    expect(selectSnapshot(list).some((m) => m.id === 'p')).toBe(false);
  });

  test('a prefix of the order within the count and character caps', () => {
    const many = Array.from({ length: 40 }, (_, i) => mem(`m${String(i).padStart(2, '0')}`, `偏好 ${i} ${'很长的描述'.repeat(10)}`, { createdAt: i }));
    const picked = selectSnapshot(many, 30, 500);
    expect(picked.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(500);
    expect(picked.map((m) => m.id)).toEqual(many.slice(0, picked.length).map((m) => m.id));
    expect(selectSnapshot(many.map((m) => ({ ...m, text: 'x' + m.id }))).length).toBe(30);
  });
});

describe('recall ranking', () => {
  const list = [mem('a', '用户是信息科学技术学院 2024 级本科生'), mem('b', '用户喜欢在农园食堂吃午饭'), mem('p', '用户喜欢食堂', { status: 'pending' })];
  test('related memories outrank unrelated ones; pending excluded', () => {
    expect(score(list[1], '中午去哪个食堂吃饭', now)).toBeGreaterThan(score(list[0], '中午去哪个食堂吃饭', now));
    expect(rankForQuery(list, '食堂', now).map((m) => m.id)).toEqual(['b']);
  });
});

describe('similar', () => {
  test('near-identical statements are found, unrelated ones are not', () => {
    const list = [mem('a', '用户喜欢在农园食堂吃午饭')];
    expect(findSimilar(list, '用户喜欢在农园食堂吃午饭。').map((m) => m.id)).toEqual(['a']);
    expect(findSimilar(list, '用户住在 32 楼')).toEqual([]);
    expect(similarity('完全不同', 'totally different')).toBe(0);
  });
});
