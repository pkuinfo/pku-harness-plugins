import { describe, expect, test } from 'bun:test';

import { findDuplicate, score, selectForContext, similarity, tokens, type Memory } from './rank';

const now = new Date(2026, 9, 18).getTime();
const mem = (id: string, text: string, over: Partial<Memory> = {}): Memory => ({
  id,
  text,
  kind: 'fact',
  pinned: false,
  uses: 0,
  createdAt: now - 86_400_000,
  updatedAt: now - 86_400_000,
  ...over,
});

describe('tokens', () => {
  test('CJK bigrams and latin words', () => {
    expect([...tokens('我住在燕园')]).toEqual(['我住', '住在', '在燕', '燕园']);
    expect(tokens('用 DeepSeek V4').has('deepseek')).toBe(true);
    expect(tokens('a 1').size).toBe(0);
  });
});

describe('ranking', () => {
  const list = [
    mem('a', '用户是信息科学技术学院 2024 级本科生'),
    mem('b', '用户喜欢在农园食堂吃午饭'),
    mem('c', '用户每周三晚上有社团活动'),
    mem('d', '提醒请提前 15 分钟', { kind: 'preference', pinned: true }),
  ];

  test('related memories outrank unrelated ones', () => {
    expect(score(list[1], '中午去哪个食堂吃饭', now)).toBeGreaterThan(score(list[0], '中午去哪个食堂吃饭', now));
  });

  test('context selection keeps pinned and related, drops unrelated', () => {
    const picked = selectForContext(list, '今天中午食堂吃什么', now).map((m) => m.id);
    expect(picked).toContain('b');
    expect(picked).toContain('d');
    expect(picked).not.toContain('c');
  });

  test('session snapshot (minScore -1): unrelated or cross-language queries still get every memory, best first', () => {
    const picked = selectForContext(list, 'And a snack', now, 20, 1500, -1).map((m) => m.id);
    expect([...picked].sort()).toEqual(list.map((m) => m.id).sort());
    expect(picked[0]).toBe('d');
  });

  test('respects the character budget', () => {
    const many = Array.from({ length: 30 }, (_, i) => mem(String(i), `食堂偏好 ${i} ${'很长的描述'.repeat(10)}`));
    const picked = selectForContext(many, '食堂', now, 20, 200);
    expect(picked.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(200);
  });
});

describe('duplicates', () => {
  test('near-identical statements are merged', () => {
    const list = [mem('a', '用户喜欢在农园食堂吃午饭')];
    expect(findDuplicate(list, '用户喜欢在农园食堂吃午饭。')?.id).toBe('a');
    expect(findDuplicate(list, '用户住在 32 楼')).toBeUndefined();
    expect(similarity('完全不同', 'totally different')).toBe(0);
  });
});
