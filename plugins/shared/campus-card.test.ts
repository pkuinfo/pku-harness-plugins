import { describe, expect, test } from 'bun:test';

import { turnoverUrl, unwrap, yuan } from './campus-card';

describe('campus-card api helpers', () => {
  test('turnoverUrl keeps the wallet query shape', () => {
    expect(turnoverUrl()).toBe('/berserker-search/search/personal/turnover?size=20&current=1&synAccessSource=h5');
    expect(turnoverUrl({ size: 5, from: '2026-10-01', to: '2026-10-23' })).toBe(
      '/berserker-search/search/personal/turnover?size=5&current=1&synAccessSource=h5&timeFrom=2026-10-01&timeTo=2026-10-23',
    );
  });
  test('unwrap and yuan', () => {
    const res = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), url: '' });
    expect(unwrap(res({ code: 200, success: true, data: { a: 1 } }) as never)).toEqual({ a: 1 });
    expect(() => unwrap(res({ code: 401, message: 'x' }) as never)).toThrow('登录已失效');
    expect(yuan(1234)).toBe(12.34);
    expect(yuan(null)).toBeNull();
  });
});
