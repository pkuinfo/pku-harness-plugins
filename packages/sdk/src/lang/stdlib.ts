import { parse as parseHtml, type HTMLElement } from 'node-html-parser';

import { builtin, callFn, ExprError, getProp, isFn, PROPS, stringify, type EvalContext, type Fn } from './expr';

/**
 * The plugin language's standard library (docs/PLUGIN-LANGUAGE.md §6.2). Every function is pure
 * (no I/O, no clock except `now`, which the runner binds), so a tool run replays exactly from
 * recorded responses. Each is callable as `f(x, …)` or `x.f(…)`.
 */

// ---------------------------------------------------------------- HTML nodes

const NODE = new WeakMap<object, HTMLElement>();

/** A parsed HTML element as the language sees it: `.text`, `.html`, `.tag`, `.attrs`, plus stdlib methods. */
export function wrapNode(el: HTMLElement, url?: string): object {
  const w = {
    [PROPS]: (k: string) => {
      switch (k) {
        case 'text':
          return squash(el.text);
        case 'rawText':
          return el.text;
        case 'html':
          return el.innerHTML;
        case 'outerHtml':
          return el.outerHTML;
        case 'tag':
          return el.tagName?.toLowerCase() ?? '';
        case 'attrs':
          return { ...el.attributes };
        case 'url':
          return url;
        default:
          return undefined;
      }
    },
    toJSON: () => squash(el.text),
  };
  NODE.set(w, el);
  BASE.set(w, url);
  return w;
}
const BASE = new WeakMap<object, string | undefined>();

function node(v: unknown, fn: string): HTMLElement {
  if (typeof v === 'string') return parseHtml(v);
  const el = v && typeof v === 'object' ? NODE.get(v) : undefined;
  if (!el) throw new ExprError(`${fn}() needs an HTML node or HTML text`);
  return el;
}

function baseOf(v: unknown): string | undefined {
  return v && typeof v === 'object' ? BASE.get(v) : undefined;
}

export function isNode(v: unknown): boolean {
  return !!v && typeof v === 'object' && NODE.has(v);
}

export function squash(s: string): string {
  return s.replace(/[\s 　]+/g, ' ').trim();
}

function select(v: unknown, css: string): object[] {
  const el = node(v, 'select');
  return el.querySelectorAll(String(css)).map((e) => wrapNode(e, baseOf(v)));
}

/** Rows of a table; `spans` expands rowspan/colspan into a full grid; `header` keys rows by the first row's labels. */
function tableRows(v: unknown, opts: { header?: boolean } = {}): unknown[] {
  const el = node(v, 'tableRows');
  const table = el.tagName?.toLowerCase() === 'table' ? el : el.querySelector('table');
  if (!table) return [];
  const grid: string[][] = [];
  const rows = table.querySelectorAll('tr');
  rows.forEach((tr, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of tr.querySelectorAll('th, td').filter((x) => x.parentNode === tr)) {
      while (grid[r]![c] !== undefined) c++;
      const rs = Math.max(1, Math.min(50, Number(cell.getAttribute('rowspan')) || 1));
      const cs = Math.max(1, Math.min(50, Number(cell.getAttribute('colspan')) || 1));
      const text = squash(cell.text);
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) (grid[r + i] ??= [])[c + j] = text;
      c += cs;
    }
  });
  const dense = grid.map((row) => Array.from({ length: row.length }, (_, i) => row[i] ?? ''));
  if (opts.header === false) return dense;
  const [head, ...body] = dense;
  if (!head) return [];
  return body.map((row) => Object.fromEntries(head.map((h, i) => [h || `col${i + 1}`, row[i] ?? ''])));
}

// ---------------------------------------------------------------- regex

const reCache = new Map<string, RegExp>();
export function re(pattern: unknown, flags = ''): RegExp {
  const src = String(pattern);
  if (src.length > 500) throw new ExprError('regular expression too long');
  const key = `${flags}/${src}`;
  let r = reCache.get(key);
  if (!r) {
    try {
      r = new RegExp(src, flags);
    } catch (e) {
      throw new ExprError(`bad regular expression ${src}: ${(e as Error).message}`);
    }
    if (reCache.size > 500) reCache.clear();
    reCache.set(key, r);
  }
  r.lastIndex = 0;
  return r;
}

function matchGroups(m: RegExpExecArray | RegExpMatchArray): unknown {
  return m.groups ? { ...m.groups, 0: m[0], ...Object.fromEntries(m.slice(1).map((g, i) => [i + 1, g])) } : Array.from(m);
}

// ---------------------------------------------------------------- dates (Beijing, UTC+8)

const TZ = 8 * 3600_000;
const DAY = 86400_000;

/** Wall-clock parts of an instant in Beijing. */
function parts(ms: number) {
  const d = new Date(ms + TZ);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
}
function fromParts(y: number, mo: number, d: number, h = 0, mi = 0, s = 0) {
  return Date.UTC(y, mo - 1, d, h, mi, s) - TZ;
}

/** Parse common campus date formats as Beijing time → epoch ms (null if unreadable). */
export function parseDate(v: unknown, nowMs: number): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s) && /\d{4}-\d\d-\d\dT/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  const time = (rest: string) => {
    const m = /(上午|下午|晚上|中午)?\s*(\d{1,2})[:：时](\d{1,2})?(?:[:：分](\d{1,2}))?/.exec(rest);
    if (!m) return [0, 0, 0];
    let h = Number(m[2]);
    if ((m[1] === '下午' || m[1] === '晚上') && h < 12) h += 12;
    if (m[1] === '中午' && h < 11) h += 12;
    return [h, Number(m[3] ?? 0), Number(m[4] ?? 0)];
  };
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(.*)$/.exec(s);
  if (m) {
    const [h, mi, se] = time(m[4] ?? '');
    return fromParts(Number(m[1]), Number(m[2]), Number(m[3]), h, mi, se);
  }
  m = /^(\d{1,2})[-/月](\d{1,2})日?(.*)$/.exec(s);
  if (m) {
    const [h, mi, se] = time(m[3] ?? '');
    return fromParts(parts(nowMs).y, Number(m[1]), Number(m[2]), h, mi, se);
  }
  m = /^(\d{8})$/.exec(s);
  if (m) return fromParts(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
  return null;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export function formatDate(ms: number, pattern = 'YYYY-MM-DD HH:mm'): string {
  const p = parts(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss|M|D|W/g, (t) =>
    t === 'YYYY' ? String(p.y) : t === 'MM' ? pad(p.mo) : t === 'DD' ? pad(p.d) : t === 'HH' ? pad(p.h) : t === 'mm' ? pad(p.mi) : t === 'ss' ? pad(p.s) : t === 'M' ? String(p.mo) : t === 'D' ? String(p.d) : WEEK[p.wd]!,
  );
}

function startOfDay(ms: number) {
  const p = parts(ms);
  return fromParts(p.y, p.mo, p.d);
}

// ---------------------------------------------------------------- helpers

function list(v: unknown, fn: string): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  throw new ExprError(`${fn}() needs a list, got ${typeof v === 'object' ? 'an object' : typeof v}`);
}
function str(v: unknown): string {
  return stringify(v);
}
function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-Hans-CN');
}
function toNum(v: unknown, fallback: unknown = null): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string') {
    const t = v.replace(/[,\s¥￥元%]/g, '');
    if (t === '') return fallback;
    const n = Number(t);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/** "1,2,5,6,7" → "1-2,5-7". */
export function compactRanges(nums: unknown[]): string {
  const ns = [...new Set(nums.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j++;
    out.push(i === j ? String(ns[i]) : `${ns[i]}-${ns[j]}`);
    i = j + 1;
  }
  return out.join(',');
}

function path(v: unknown, p: string): unknown {
  let cur = v;
  for (const seg of String(p).match(/[^.[\]]+/g) ?? []) {
    if (cur == null) return undefined;
    cur = getProp(cur, /^\d+$/.test(seg) ? Number(seg) : seg);
  }
  return cur;
}

/** Text of the element with the most text among block containers (article extraction). */
function largestText(v: unknown): string {
  const el = node(v, 'largestText');
  let best = '';
  for (const e of el.querySelectorAll('article, main, section, div, td')) {
    const t = squash(e.text);
    // Prefer the innermost container: a parent only wins with substantially more text.
    if (t.length > best.length * 1.3) best = t;
  }
  return best || squash(el.text);
}

// ---------------------------------------------------------------- the table

type Impl = (ctx: EvalContext, a: unknown[]) => unknown;
const fns: Record<string, Impl> = {
  // lists
  map: (c, [l, f]) => list(l, 'map').map((x, i) => callFn(f, [x, i], c)),
  filter: (c, [l, f]) => list(l, 'filter').filter((x, i) => !!callFn(f, [x, i], c)),
  find: (c, [l, f]) => list(l, 'find').find((x, i) => !!callFn(f, [x, i], c)),
  findIndex: (c, [l, f]) => list(l, 'findIndex').findIndex((x, i) => !!callFn(f, [x, i], c)),
  some: (c, [l, f]) => list(l, 'some').some((x, i) => !!callFn(f, [x, i], c)),
  every: (c, [l, f]) => list(l, 'every').every((x, i) => !!callFn(f, [x, i], c)),
  flatMap: (c, [l, f]) => list(l, 'flatMap').flatMap((x, i) => callFn(f, [x, i], c) as unknown),
  reduce: (c, [l, f, init]) => list(l, 'reduce').reduce((acc, x, i) => callFn(f, [acc, x, i], c), init),
  flat: (_c, [l, d]) => list(l, 'flat').flat(Number(d ?? 1) as 1),
  slice: (_c, [l, a, b]) => (typeof l === 'string' ? l.slice(Number(a ?? 0), b == null ? undefined : Number(b)) : list(l, 'slice').slice(Number(a ?? 0), b == null ? undefined : Number(b))),
  concat: (_c, [l, ...rest]) => list(l, 'concat').concat(...rest.map((r) => (Array.isArray(r) ? r : [r]))),
  includes: (_c, [l, x]) => (typeof l === 'string' ? l.includes(str(x)) : list(l, 'includes').includes(x)),
  indexOf: (_c, [l, x]) => (typeof l === 'string' ? l.indexOf(str(x)) : list(l, 'indexOf').indexOf(x)),
  join: (_c, [l, sep]) =>
    list(l, 'join')
      .map(str)
      .join(sep == null ? ',' : str(sep)),
  reverse: (_c, [l]) => [...list(l, 'reverse')].reverse(),
  sort: (_c, [l, desc]) => [...list(l, 'sort')].sort((a, b) => (desc ? cmp(b, a) : cmp(a, b))),
  sortBy: (c, [l, f, desc]) => {
    const keyed = list(l, 'sortBy').map((x) => ({ x, k: isFn(f) ? callFn(f, [x], c) : getProp(x, f) }));
    keyed.sort((a, b) => (desc ? cmp(b.k, a.k) : cmp(a.k, b.k)));
    return keyed.map((e) => e.x);
  },
  groupBy: (c, [l, f]) => {
    const out: Record<string, unknown[]> = {};
    for (const x of list(l, 'groupBy')) (out[str(isFn(f) ? callFn(f, [x], c) : getProp(x, f))] ??= []).push(x);
    return out;
  },
  unique: (c, [l, f]) => {
    const seen = new Set<unknown>();
    return list(l, 'unique').filter((x) => {
      const k = f == null ? (typeof x === 'object' ? JSON.stringify(x) : x) : isFn(f) ? callFn(f, [x], c) : getProp(x, f);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
  sum: (c, [l, f]) => list(l, 'sum').reduce<number>((s, x) => s + (Number(f == null ? x : isFn(f) ? callFn(f, [x], c) : getProp(x, f)) || 0), 0),
  count: (c, [l, f]) => (f == null ? list(l, 'count').length : list(l, 'count').filter((x) => !!callFn(f, [x], c)).length),
  min: (_c, a) => {
    const ns = (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map(Number).filter(Number.isFinite);
    return ns.length ? Math.min(...ns) : null;
  },
  max: (_c, a) => {
    const ns = (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map(Number).filter(Number.isFinite);
    return ns.length ? Math.max(...ns) : null;
  },
  range: (_c, [a, b, step]) => {
    const [from, to] = b == null ? [0, Number(a)] : [Number(a), Number(b)];
    const s = Number(step ?? 1) || 1;
    const n = Math.max(0, Math.ceil((to - from) / s));
    if (n > 10_000) throw new ExprError('range() is limited to 10 000 items');
    return Array.from({ length: n }, (_, i) => from + i * s);
  },
  chunk: (_c, [l, n]) => {
    const xs = list(l, 'chunk');
    const size = Math.max(1, Number(n) || 1);
    return Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, i * size + size));
  },
  zip: (_c, [a, b]) => list(a, 'zip').map((x, i) => [x, list(b, 'zip')[i]]),
  length: (_c, [x]) => (typeof x === 'string' || Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : 0),
  compactRanges: (_c, [l]) => compactRanges(list(l, 'compactRanges')),

  // objects
  keys: (_c, [o]) => (o && typeof o === 'object' ? Object.keys(o) : []),
  values: (_c, [o]) => (o && typeof o === 'object' ? Object.values(o) : []),
  entries: (_c, [o]) => (o && typeof o === 'object' ? Object.entries(o) : []),
  fromEntries: (_c, [l]) => Object.fromEntries(list(l, 'fromEntries') as [string, unknown][]),
  pick: (_c, [o, ...ks]) => Object.fromEntries(ks.flat().map((k) => [str(k), getProp(o, str(k))])),
  omit: (_c, [o, ...ks]) => {
    const drop = new Set(ks.flat().map(str));
    return Object.fromEntries(Object.entries((o as object) ?? {}).filter(([k]) => !drop.has(k)));
  },
  merge: (_c, objs) => Object.assign({}, ...objs.filter((o) => o && typeof o === 'object')),

  // strings
  str: (_c, [x]) => str(x),
  trim: (_c, [s]) => str(s).trim(),
  squash: (_c, [s]) => squash(str(s)),
  lower: (_c, [s]) => str(s).toLowerCase(),
  upper: (_c, [s]) => str(s).toUpperCase(),
  split: (_c, [s, sep, isRegex]) => str(s).split(isRegex ? re(sep, 'g') : str(sep)),
  replace: (_c, [s, pattern, with_]) => str(s).replace(re(pattern, 'g'), str(with_)),
  replaceText: (_c, [s, find, with_]) => str(s).split(str(find)).join(str(with_)),
  match: (_c, [s, pattern, group]) => {
    const m = re(pattern).exec(str(s));
    if (!m) return null;
    return group == null ? matchGroups(m) : (m.groups && typeof group === 'string' ? m.groups[group] : m[Number(group)]) ?? null;
  },
  matchAll: (_c, [s, pattern]) => [...str(s).matchAll(re(pattern, 'g'))].slice(0, 5000).map(matchGroups),
  test: (_c, [s, pattern]) => re(pattern).test(str(s)),
  startsWith: (_c, [s, x]) => str(s).startsWith(str(x)),
  endsWith: (_c, [s, x]) => str(s).endsWith(str(x)),
  padStart: (_c, [s, n, ch]) => str(s).padStart(Number(n), ch == null ? ' ' : str(ch)),
  clip: (_c, [s, n]) => {
    const t = str(s);
    const max = Number(n) || 200;
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  },
  fmt: (_c, [t, values]) => str(t).replace(/\{(\w+)\}/g, (_, k: string) => str(getProp(values, k))),

  // numbers
  num: (_c, [x, fallback]) => toNum(x, fallback ?? null),
  int: (_c, [x, fallback]) => {
    const n = toNum(x, null);
    return n == null ? (fallback ?? null) : Math.trunc(n as number);
  },
  round: (_c, [x, d]) => {
    const f = 10 ** Number(d ?? 0);
    return Math.round(Number(x) * f) / f;
  },
  fixed: (_c, [x, d]) => Number(x).toFixed(Number(d ?? 2)),
  abs: (_c, [x]) => Math.abs(Number(x)),
  floor: (_c, [x]) => Math.floor(Number(x)),
  ceil: (_c, [x]) => Math.ceil(Number(x)),
  yuan: (_c, [fen]) => (fen == null || fen === '' ? null : Math.round(Number(fen)) / 100),

  // dates
  date: (c, [x]) => parseDate(x, Number((c as EvalContext & { now?: number }).now ?? Date.now())),
  formatDate: (_c, [ms, p]) => (ms == null ? '' : formatDate(Number(ms), p == null ? undefined : str(p))),
  addDays: (_c, [ms, n]) => Number(ms) + Number(n) * DAY,
  addMinutes: (_c, [ms, n]) => Number(ms) + Number(n) * 60_000,
  daysBetween: (_c, [a, b]) => Math.round((startOfDay(Number(b)) - startOfDay(Number(a))) / DAY),
  startOfDay: (_c, [ms]) => startOfDay(Number(ms)),
  minutesOf: (_c, [x]) => {
    if (typeof x === 'number') {
      const p = parts(x);
      return p.h * 60 + p.mi;
    }
    const m = /(\d{1,2})[:：](\d{2})/.exec(str(x));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  },
  weekday: (_c, [ms]) => {
    const w = parts(Number(ms)).wd;
    return w === 0 ? 7 : w;
  },

  // urls
  url: (_c, [base, p]) => {
    try {
      return new URL(str(p), str(base)).toString();
    } catch {
      return str(p);
    }
  },
  query: (_c, [u, name]) => {
    try {
      return new URL(str(u)).searchParams.get(str(name));
    } catch {
      const m = new RegExp(`[?&]${str(name).replace(/[^\w-]/g, '')}=([^&#]*)`).exec(str(u));
      return m ? decodeURIComponent(m[1]!) : null;
    }
  },
  encode: (_c, [s]) => encodeURIComponent(str(s)),
  decode: (_c, [s]) => {
    try {
      return decodeURIComponent(str(s));
    } catch {
      return str(s);
    }
  },

  // json
  json: (_c, [s]) => {
    try {
      return JSON.parse(str(s));
    } catch {
      throw new ExprError('json(): not valid JSON');
    }
  },
  path: (_c, [v, p]) => path(v, str(p)),

  // html
  html: (_c, [s, url]) => wrapNode(parseHtml(str(s)), url == null ? undefined : str(url)),
  select: (_c, [v, css]) => select(v, str(css)),
  first: (_c, [v, css]) => {
    const el = node(v, 'first').querySelector(str(css));
    return el ? wrapNode(el, baseOf(v)) : null;
  },
  attr: (_c, [v, name]) => node(v, 'attr').getAttribute(str(name)) ?? null,
  data: (_c, [v, name]) => node(v, 'data').getAttribute(`data-${str(name)}`) ?? null,
  text: (_c, [v]) => (typeof v === 'string' ? squash(parseHtml(v).text) : squash(node(v, 'text').text)),
  children: (_c, [v]) =>
    node(v, 'children')
      .childNodes.filter((n) => (n as HTMLElement).tagName)
      .map((n) => wrapNode(n as HTMLElement, baseOf(v))),
  parent: (_c, [v]) => {
    const p = node(v, 'parent').parentNode;
    return p ? wrapNode(p, baseOf(v)) : null;
  },
  tableRows: (_c, [v, opts]) => tableRows(v, (opts as { header?: boolean }) ?? {}),
  options: (_c, [v]) =>
    node(v, 'options')
      .querySelectorAll('option')
      .map((o) => ({ value: o.getAttribute('value') ?? squash(o.text), label: squash(o.text), selected: o.getAttribute('selected') != null })),
  htmlText: (_c, [s]) => squash(parseHtml(str(s)).text),
  largestText: (_c, [v]) => largestText(v),

  // types
  isList: (_c, [x]) => Array.isArray(x),
  typeOf: (_c, [x]) => (x === null ? 'null' : Array.isArray(x) ? 'list' : isNode(x) ? 'node' : typeof x),
};

export const STDLIB: Record<string, Fn> = Object.fromEntries(Object.entries(fns).map(([name, impl]) => [name, builtin(name, impl)]));
export const STDLIB_NAMES = Object.keys(fns);
