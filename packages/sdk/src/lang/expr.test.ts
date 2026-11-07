import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { callFn, compile, evaluate, Scope, template, type EvalContext } from './expr';
import { STDLIB } from './stdlib';

function ctx(ops = 100_000): EvalContext & { now: number } {
  const c: EvalContext & { now: number } = { budget: { ops }, stdlib: STDLIB, now: Date.UTC(2026, 9, 23, 4, 0), call: (fn, args) => callFn(fn, args, c) };
  return c;
}
function ev(src: string, vars: Record<string, unknown> = {}, c = ctx()) {
  const s = new Scope();
  for (const [k, v] of Object.entries(vars)) s.set(k, v);
  return evaluate(compile(src), s, c);
}

describe('expressions', () => {
  test('literals, operators, precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev("'a' + 1")).toBe('a1');
    expect(ev('10 % 4 == 2 && !false')).toBe(true);
    expect(ev('null ?? 5')).toBe(5);
    expect(ev('0 || "x"')).toBe('x');
    expect(ev('3 > 2 ? "yes" : "no"')).toBe('yes');
    expect(ev('1 === 1 && 1 !== 2')).toBe(true);
    expect(ev('-x', { x: 4 })).toBe(-4);
  });

  test('objects, arrays, spread, member access', () => {
    expect(ev('{ a: 1, "b c": 2, [k]: 3, k }', { k: 'z' })).toEqual({ a: 1, 'b c': 2, z: 3, k: 'z' });
    expect(ev('[1, ...xs, 4]', { xs: [2, 3] })).toEqual([1, 2, 3, 4]);
    expect(ev('{ ...o, b: 2 }', { o: { a: 1 } })).toEqual({ a: 1, b: 2 });
    expect(ev('o.a.b[1]', { o: { a: { b: [5, 6] } } })).toBe(6);
    expect(ev('o?.missing?.deep', { o: null })).toBeUndefined();
    expect(ev('xs.length + s.length', { xs: [1, 2], s: 'abc' })).toBe(5);
    expect(ev("o['x-y']", { o: { 'x-y': 1 } })).toBe(1);
  });

  test('lambdas and method-style stdlib calls', () => {
    expect(ev('xs.map(x => x * 2)', { xs: [1, 2] })).toEqual([2, 4]);
    expect(ev('xs.filter((x, i) => i > 0).join("-")', { xs: ['a', 'b', 'c'] })).toBe('b-c');
    expect(ev('map(xs, x => x + 1)', { xs: [1] })).toEqual([2]);
    expect(ev('sortBy(xs, x => x.n, true).map(x => x.n)', { xs: [{ n: 1 }, { n: 3 }, { n: 2 }] })).toEqual([3, 2, 1]);
    expect(ev('xs.sum(x => x.v)', { xs: [{ v: 1 }, { v: 2.5 }] })).toBe(3.5);
    expect(ev('range(1, 13).filter(i => r["c" + i] == "").compactRanges()', { r: { c1: '', c2: '', c3: 'x', c5: '', c6: '' } })).toBe('1-2,5-6');
    expect(ev('((a, b) => a + b)(1, 2)')).toBe(3);
    expect(ev('(() => 7)()')).toBe(7);
  });

  test('own function properties win over stdlib names', () => {
    expect(ev('o.count', { o: { count: 3 } })).toBe(3);
    expect(ev('xs.count()', { xs: [1, 2] })).toBe(2);
  });

  test('no escape to JavaScript internals', () => {
    expect(() => ev('o.constructor', { o: {} })).toThrow(/not allowed/);
    expect(() => ev('o["__proto__"]', { o: {} })).toThrow(/not allowed/);
    expect(() => ev('{ __proto__: 1 }')).toThrow(/not allowed/);
    expect(ev('o.toString', { o: {} })).toBeUndefined();
    expect(() => ev('globalThis')).toThrow(/unknown name/);
    expect(() => ev('xs.push(1)', { xs: [] })).toThrow(/no method 'push'/);
  });

  test('budget stops runaway work', () => {
    expect(() => ev('range(0, 5000).map(x => range(0, 5000).length)', {}, ctx(10_000))).toThrow(/budget/);
  });

  test('syntax errors point at the expression', () => {
    expect(() => compile('a +')).toThrow(/unexpected/);
    expect(() => compile("'open")).toThrow(/unterminated/);
  });

  test('templates keep types for a single expression', () => {
    const s = new Scope();
    s.set('n', 3);
    s.set('o', { a: [1] });
    expect(template('${n}', s, ctx())).toBe(3);
    expect(template('page ${n + 1} of ${o.a}', s, ctx())).toBe('page 4 of [1]');
    expect(template("${ {x: '}'}.x }", s, ctx())).toBe('}');
    expect(template('plain', s, ctx())).toBe('plain');
  });
});

describe('stdlib', () => {
  test('dates are Beijing time', () => {
    const t = ev("date('2026-10-23 08:30')") as number;
    expect(new Date(t).toISOString()).toBe('2026-10-23T00:30:00.000Z');
    expect(ev("formatDate(date('2026年10月5日 下午3:05'), 'M月D日 HH:mm 周W')")).toBe('10月5日 15:05 周一');
    expect(ev("daysBetween(date('2026-10-23 23:59'), date('2026-10-24 00:01'))")).toBe(1);
    expect(ev("minutesOf('08:30')")).toBe(510);
    expect(ev("weekday(date('2026-10-25'))")).toBe(7);
  });

  test('strings and regex', () => {
    expect(ev("match('1~15周 每周周二5~6节', '(\\\\d+)~(\\\\d+)周')")).toEqual(['1~15周', '1', '15']);
    expect(ev("match('余额 12.5 元', '([\\\\d.]+)', 1)")).toBe('12.5');
    expect(ev("matchAll('a1b22', '\\\\d+').map(m => m[0])")).toEqual(['1', '22']);
    expect(ev("replace('a  b', '\\\\s+', '-')")).toBe('a-b');
    expect(ev("clip('abcdef', 4)")).toBe('abc…');
    expect(ev("fmt('{a}/{b}', { a: 1, b: 'x' })")).toBe('1/x');
    expect(ev("num('¥1,234.50')")).toBe(1234.5);
    expect(ev("num('n/a', 0)")).toBe(0);
    expect(ev('yuan(12345)')).toBe(123.45);
  });

  test('html selection and tables with spans', () => {
    const page = `<ul><li class="n"><a href="/a?id=1">First</a><span class="d">2026-10-01</span></li><li class="n"><a href="b.htm">Second</a></li></ul>
      <table><tr><th>时间</th><th>周一</th></tr><tr><td rowspan="2">早餐</td><td>6:30</td></tr><tr><td>7:00</td></tr></table>`;
    expect(ev("select(html(p), 'li.n a').map(a => a.text)", { p: page })).toEqual(['First', 'Second']);
    expect(ev("first(html(p, 'https://x.edu/list/'), 'li a').attr('href')", { p: page })).toBe('/a?id=1');
    expect(ev("url('https://x.edu/list/', 'b.htm')")).toBe('https://x.edu/list/b.htm');
    expect(ev("query('https://x.edu/a?id=7&k=v', 'id')")).toBe('7');
    expect(ev("tableRows(html(p))", { p: page })).toEqual([
      { 时间: '早餐', 周一: '6:30' },
      { 时间: '早餐', 周一: '7:00' },
    ]);
    expect(ev("htmlText('<p>a &amp; <b>b</b></p>')")).toBe('a & b');
  });
});

describe('string escapes', () => {
  test('unknown escapes keep their backslash (regexes survive YAML)', () => {
    expect(ev("'\\s+'")).toBe('\\s+');
    expect(ev("replace('a  b', '\\s+', '-')")).toBe('a-b');
    expect(ev("'a\\'b' + '\\\\' + '\\n'")).toBe("a'b\\\n");
  });
});

describe('additions from the ports', () => {
  test('inline regex flags and comments', () => {
    expect(ev("test('YanYuan', '(?i)^yanyuan$')")).toBe(true);
    expect(ev("replace('A a', '(?i)a', 'x')")).toBe('x x');
    expect(ev('1 + /* two */ 2 // three\n + 3')).toBe(6);
    expect(ev("'//not a comment'")).toBe('//not a comment');
  });

  test('tableRows cells keep merged-cell identity', () => {
    const page = '<table><tr><td rowspan="2">A</td><td>x</td></tr><tr><td>A</td></tr></table>';
    const cells = ev('tableRows(html(p), { cells: true })', { p: page }) as { text: string; id: number; rowspan: number }[][];
    expect(cells[0]![0]!.id).toBe(cells[1]![0]!.id);
    expect(cells[0]![0]!.rowspan).toBe(2);
    expect(cells[1]![1]!.text).toBe('A');
    expect(cells[1]![1]!.id).not.toBe(cells[0]![0]!.id);
  });
});

describe('html helpers from the notices port', () => {
  test('htmlLines keeps paragraphs; without drops elements', () => {
    expect(ev("htmlLines('<p>a <b>b</b></p><p>c</p><br>d<script>x()</script>')")).toBe('a b\nc\nd');
    expect(ev("text(without(html('<div><h1>T</h1><p>body</p></div>'), 'h1'))")).toBe('body');
  });
});

describe('additions from the course-catalog port', () => {
  test('\\u escapes, null == undefined, matchAt', () => {
    expect(ev("'a\\u00a0b'")).toBe('a b');
    expect(ev('o.missing == null', { o: {} })).toBe(true);
    expect(ev('0 == null')).toBe(false);
    expect(ev("matchAt('x1y22', '\\d+')")).toEqual([
      { text: '1', index: 1, groups: [] },
      { text: '22', index: 3, groups: [] },
    ]);
  });
});

describe('base64', () => {
  test('UTF-8 round trip, padding and URL-safe input', () => {
    expect(ev("base64('a')")).toBe('YQ==');
    expect(ev("base64('ab')")).toBe('YWI=');
    expect(ev("base64('abc')")).toBe('YWJj');
    expect(ev("base64('张三')")).toBe(Buffer.from('张三').toString('base64'));
    expect(ev("base64('😀')")).toBe(Buffer.from('😀').toString('base64'));
    expect(ev("unbase64(base64('学号 2000000000 😀'))")).toBe('学号 2000000000 😀');
    expect(ev("unbase64('fn5-')")).toBe('~~~');
    expect(ev("unbase64('Pz8_')")).toBe('???');
    expect(ev("unbase64('/w==')")).toBe('\uFFFD');
  });
});

describe('json', () => {
  test('parses, and falls back only when asked', () => {
    expect(ev(`json('{"a":[1]}').a[0]`)).toBe(1);
    expect(ev("json('nope', 'bad')")).toBe('bad');
    expect(ev("json('nope', null)")).toBeNull();
    expect(ev("json('null', 'bad')")).toBeNull();
    expect(ev("'x'.json(0)")).toBe(0);
    expect(() => ev("json('nope')")).toThrow('not valid JSON');
  });
});

describe('sha256 and randomId', () => {
  test('sha256 matches node:crypto (UTF-8, padding edges)', () => {
    for (const s of ['', 'abc', '张三😀', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(64), 'z'.repeat(1000)])
      expect(ev('sha256(s)', { s })).toBe(createHash('sha256').update(s).digest('hex'));
  });
  test('randomId gives n characters of 0-9a-z, different each time', () => {
    const a = ev('randomId(11)') as string;
    expect(a).toMatch(/^[0-9a-z]{11}$/);
    expect(ev('randomId()')).toMatch(/^[0-9a-z]{16}$/);
    expect(ev('randomId(11)')).not.toBe(a);
  });
  test('randomId works without globalThis.crypto (Hermes)', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    try {
      expect(ev('randomId(11)')).toMatch(/^[0-9a-z]{11}$/);
    } finally {
      if (saved) Object.defineProperty(globalThis, 'crypto', saved);
    }
  });
});
