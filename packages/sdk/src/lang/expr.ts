/**
 * The plugin language's expressions (docs/PLUGIN-LANGUAGE.md §6.2): a small, safe subset of
 * JavaScript. Hand-written Pratt parser → AST → evaluator with an operation budget. There is no
 * access to globals, prototypes or host objects: names resolve only in the run's scope, and
 * `x.f(…)` calls a stdlib function `f(x, …)` unless `x` has an own property `f` that is a function.
 */

export type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'id'; name: string }
  | { k: 'arr'; items: (Node | { k: 'spread'; e: Node })[] }
  | { k: 'obj'; props: ({ key: string | Node; value: Node } | { k: 'spread'; e: Node })[] }
  | { k: 'mem'; obj: Node; prop: Node; optional: boolean }
  | { k: 'call'; callee: Node; args: Node[]; optional: boolean }
  | { k: 'un'; op: string; e: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'cond'; c: Node; a: Node; b: Node }
  | { k: 'fn'; params: string[]; body: Node };

export class ExprError extends Error {
  constructor(
    message: string,
    readonly source?: string,
  ) {
    super(source ? `${message} — in \`${source.length > 120 ? source.slice(0, 117) + '…' : source}\`` : message);
  }
}

// ---------------------------------------------------------------- tokenizer

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'eof'; v: string; pos: number };

const OPS = ['===', '!==', '...', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '(', ')', '[', ']', '{', '}', ',', '.', '?', ':', '+', '-', '*', '/', '%', '<', '>', '!'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          const e = src[j + 1];
          // Known escapes as in JS; any other keeps its backslash, so regexes like '\d+' survive
          // one round of YAML unescaping (unlike JS, where '\d' === 'd').
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === '\\' || e === "'" || e === '"' ? e : `\\${e ?? ''}`;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new ExprError('unterminated string', src);
      out.push({ t: 'str', v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$一-鿿]/.test(c)) {
      const m = /^[A-Za-z_$一-鿿][A-Za-z0-9_$一-鿿]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected character '${c}'`, src);
    // `?.` followed by a digit is a ternary, not optional chaining (a?.5:1).
    if (op === '?.' && /[0-9]/.test(src[i + 2] ?? '')) {
      out.push({ t: 'op', v: '?', pos: i });
      i += 1;
      continue;
    }
    out.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  out.push({ t: 'eof', v: '', pos: src.length });
  return out;
}

// ---------------------------------------------------------------- parser

const BIN: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '===': 4,
  '!==': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
};

const KEYWORDS: Record<string, unknown> = { true: true, false: false, null: null, undefined: undefined };
const FORBIDDEN = new Set(['constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const isOp = (v: string) => peek().t === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected '${v}' but found '${peek().v || 'end'}'`, src);
    p++;
  };

  // Arrow function lookahead: `x =>` or `(a, b) =>` or `() =>`.
  function arrowAhead(): string[] | null {
    const t = peek();
    if (t.t === 'id' && toks[p + 1]?.v === '=>' && toks[p + 1]?.t === 'op') return [t.v];
    if (!(t.t === 'op' && t.v === '(')) return null;
    const params: string[] = [];
    let q = p + 1;
    if (toks[q]?.t === 'op' && toks[q]?.v === ')') return toks[q + 1]?.v === '=>' ? params : null;
    for (;;) {
      const id = toks[q];
      if (id?.t !== 'id') return null;
      params.push(id.v);
      const sep = toks[q + 1];
      if (sep?.t === 'op' && sep.v === ',') {
        q += 2;
        continue;
      }
      if (sep?.t === 'op' && sep.v === ')') return toks[q + 2]?.t === 'op' && toks[q + 2]?.v === '=>' ? params : null;
      return null;
    }
  }

  function expr(): Node {
    const params = arrowAhead();
    if (params) {
      if (peek().t === 'id') p += 2;
      else p += params.length === 0 ? 3 : params.length * 2 + 2;
      return { k: 'fn', params, body: expr() };
    }
    return cond();
  }

  function cond(): Node {
    const c = binary(0);
    if (isOp('?')) {
      p++;
      const a = expr();
      expect(':');
      const b = expr();
      return { k: 'cond', c, a, b };
    }
    return c;
  }

  function binary(min: number): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      const prec = t.t === 'op' ? BIN[t.v] : undefined;
      if (prec === undefined || prec <= min) return left;
      p++;
      const right = binary(prec);
      left = { k: 'bin', op: t.v === '===' ? '==' : t.v === '!==' ? '!=' : t.v, a: left, b: right };
    }
  }

  function unary(): Node {
    if (isOp('!') || isOp('-') || isOp('+')) {
      const op = next().v;
      return { k: 'un', op, e: unary() };
    }
    return postfix(primary());
  }

  function propName(): Node {
    const t = next();
    if (t.t !== 'id') throw new ExprError(`expected a property name after '.'`, src);
    if (FORBIDDEN.has(t.v)) throw new ExprError(`'${t.v}' is not allowed`, src);
    return { k: 'lit', v: t.v };
  }

  function args(): Node[] {
    const out: Node[] = [];
    expect('(');
    while (!isOp(')')) {
      out.push(expr());
      if (!isOp(')')) expect(',');
    }
    expect(')');
    return out;
  }

  function postfix(e: Node): Node {
    for (;;) {
      if (isOp('.')) {
        p++;
        e = { k: 'mem', obj: e, prop: propName(), optional: false };
      } else if (isOp('?.')) {
        p++;
        if (isOp('(')) e = { k: 'call', callee: e, args: args(), optional: true };
        else if (isOp('[')) {
          p++;
          const prop = expr();
          expect(']');
          e = { k: 'mem', obj: e, prop, optional: true };
        } else e = { k: 'mem', obj: e, prop: propName(), optional: true };
      } else if (isOp('[')) {
        p++;
        const prop = expr();
        expect(']');
        e = { k: 'mem', obj: e, prop, optional: false };
      } else if (isOp('(')) {
        e = { k: 'call', callee: e, args: args(), optional: false };
      } else return e;
    }
  }

  function primary(): Node {
    const t = next();
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'id') {
      if (t.v in KEYWORDS) return { k: 'lit', v: KEYWORDS[t.v] };
      if (FORBIDDEN.has(t.v)) throw new ExprError(`'${t.v}' is not allowed`, src);
      return { k: 'id', name: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = expr();
      expect(')');
      return e;
    }
    if (t.t === 'op' && t.v === '[') {
      const items: (Node | { k: 'spread'; e: Node })[] = [];
      while (!isOp(']')) {
        if (isOp('...')) {
          p++;
          items.push({ k: 'spread', e: expr() });
        } else items.push(expr());
        if (!isOp(']')) expect(',');
      }
      expect(']');
      return { k: 'arr', items };
    }
    if (t.t === 'op' && t.v === '{') {
      const props: ({ key: string | Node; value: Node } | { k: 'spread'; e: Node })[] = [];
      while (!isOp('}')) {
        if (isOp('...')) {
          p++;
          props.push({ k: 'spread', e: expr() });
        } else {
          const kt = next();
          let key: string | Node;
          if (kt.t === 'id' || kt.t === 'str' || kt.t === 'num') key = kt.v;
          else if (kt.t === 'op' && kt.v === '[') {
            key = expr();
            expect(']');
          } else throw new ExprError(`bad object key '${kt.v}'`, src);
          if (typeof key === 'string' && FORBIDDEN.has(key)) throw new ExprError(`'${key}' is not allowed`, src);
          if (isOp(':')) {
            p++;
            props.push({ key, value: expr() });
          } else if (kt.t === 'id') props.push({ key, value: { k: 'id', name: kt.v } });
          else throw new ExprError(`expected ':' after key`, src);
        }
        if (!isOp('}')) expect(',');
      }
      expect('}');
      return { k: 'obj', props };
    }
    throw new ExprError(`unexpected '${t.v || 'end of expression'}'`, src);
  }

  const node = expr();
  if (peek().t !== 'eof') throw new ExprError(`unexpected '${peek().v}'`, src);
  return node;
}

// ---------------------------------------------------------------- evaluator

/** A function value: a user lambda or a stdlib builtin. */
export type Fn = { kind: 'lambda'; params: string[]; body: Node; scope: Scope; src: string } | { kind: 'builtin'; name: string; impl: (ctx: EvalContext, args: unknown[]) => unknown };

export function isFn(v: unknown): v is Fn {
  return typeof v === 'object' && v !== null && 'kind' in v && ((v as Fn).kind === 'lambda' || (v as Fn).kind === 'builtin') && FN_TAG in v;
}

const FN_TAG = Symbol('fn');
export function lambda(params: string[], body: Node, scope: Scope, src: string): Fn {
  return { kind: 'lambda', params, body, scope, src, [FN_TAG]: true } as Fn;
}
export function builtin(name: string, impl: (ctx: EvalContext, args: unknown[]) => unknown): Fn {
  return { kind: 'builtin', name, impl, [FN_TAG]: true } as Fn;
}

export class Scope {
  private readonly vars = new Map<string, unknown>();
  constructor(readonly parent?: Scope) {}
  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false);
  }
  get(name: string): unknown {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.parent) return this.parent.get(name);
    throw new ExprError(`unknown name '${name}'`);
  }
  set(name: string, value: unknown) {
    this.vars.set(name, value);
  }
  child(): Scope {
    return new Scope(this);
  }
}

export interface EvalContext {
  /** Remaining operations; shared by the whole tool run. */
  budget: { ops: number };
  /** stdlib functions callable by name or as methods. */
  stdlib: Record<string, Fn>;
  /** Call any function value (lambda or builtin). */
  call(fn: unknown, args: unknown[]): unknown;
}

function tick(ctx: EvalContext) {
  if (--ctx.budget.ops < 0) throw new ExprError('the plugin ran out of its computation budget');
}

function own(obj: unknown, key: string): boolean {
  return typeof obj === 'object' && obj !== null && Object.prototype.hasOwnProperty.call(obj, key);
}

/** Property read with the language's rules: own data only, plus `length` and the HTML node API. */
export function getProp(obj: unknown, key: unknown): unknown {
  if (typeof key === 'string' && FORBIDDEN.has(key)) throw new ExprError(`'${key}' is not allowed`);
  if (typeof obj === 'string') {
    if (key === 'length') return obj.length;
    if (typeof key === 'number') return obj[key];
    return undefined;
  }
  if (Array.isArray(obj)) {
    if (key === 'length') return obj.length;
    if (typeof key === 'number' || (typeof key === 'string' && /^\d+$/.test(key))) return obj[Number(key)];
    return undefined;
  }
  if (obj && typeof obj === 'object') {
    const props = (obj as { [PROPS]?: (k: string) => unknown })[PROPS];
    if (props) return props(String(key));
    return own(obj, String(key)) ? (obj as Record<string, unknown>)[String(key)] : undefined;
  }
  return undefined;
}

/** Objects that expose computed properties to the language (HTML nodes, responses). */
export const PROPS = Symbol('props');

function truthy(v: unknown) {
  return !!v && !(Array.isArray(v) && false);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  return typeof v === 'object' ? 'an object' : typeof v;
}

export function evaluate(node: Node, scope: Scope, ctx: EvalContext): unknown {
  tick(ctx);
  switch (node.k) {
    case 'lit':
      return node.v;
    case 'id':
      if (scope.has(node.name)) return scope.get(node.name);
      if (node.name in ctx.stdlib) return ctx.stdlib[node.name];
      throw new ExprError(`unknown name '${node.name}'`);
    case 'arr': {
      const out: unknown[] = [];
      for (const it of node.items) {
        if ('k' in it && it.k === 'spread') {
          const v = evaluate(it.e, scope, ctx);
          if (Array.isArray(v)) out.push(...v);
          else if (v != null) throw new ExprError(`can't spread ${describe(v)} into a list`);
        } else out.push(evaluate(it as Node, scope, ctx));
      }
      return out;
    }
    case 'obj': {
      const out: Record<string, unknown> = {};
      for (const pr of node.props) {
        if ('k' in pr && pr.k === 'spread') {
          const v = evaluate(pr.e, scope, ctx);
          if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, v);
        } else {
          const { key, value } = pr as { key: string | Node; value: Node };
          const k = typeof key === 'string' ? key : String(evaluate(key, scope, ctx));
          if (FORBIDDEN.has(k)) throw new ExprError(`'${k}' is not allowed`);
          out[k] = evaluate(value, scope, ctx);
        }
      }
      return out;
    }
    case 'mem': {
      const obj = evaluate(node.obj, scope, ctx);
      if (obj == null) {
        if (node.optional) return undefined;
        const name = node.prop.k === 'lit' ? String(node.prop.v) : '…';
        throw new ExprError(`can't read '${name}' of ${obj === null ? 'null' : 'undefined'}`);
      }
      return getProp(obj, evaluate(node.prop, scope, ctx));
    }
    case 'call': {
      // Method call: x.f(args) → own function property, else stdlib f(x, …args).
      if (node.callee.k === 'mem') {
        const recv = evaluate(node.callee.obj, scope, ctx);
        if (recv == null && (node.callee.optional || node.optional)) return undefined;
        const name = node.callee.prop.k === 'lit' ? String(node.callee.prop.v) : String(evaluate(node.callee.prop, scope, ctx));
        const prop = recv == null ? undefined : getProp(recv, name);
        const args = node.args.map((a) => evaluate(a, scope, ctx));
        if (isFn(prop)) return ctx.call(prop, args);
        const fn = ctx.stdlib[name];
        if (!fn) throw new ExprError(`${describe(recv)} has no method '${name}'`);
        return ctx.call(fn, [recv, ...args]);
      }
      const fn = evaluate(node.callee, scope, ctx);
      if (fn == null && node.optional) return undefined;
      if (!isFn(fn)) throw new ExprError(`${node.callee.k === 'id' ? `'${node.callee.name}'` : 'value'} is not a function`);
      return ctx.call(
        fn,
        node.args.map((a) => evaluate(a, scope, ctx)),
      );
    }
    case 'un': {
      const v = evaluate(node.e, scope, ctx);
      if (node.op === '!') return !truthy(v);
      if (node.op === '-') return -(v as number);
      return +(v as number);
    }
    case 'bin': {
      if (node.op === '&&') {
        const a = evaluate(node.a, scope, ctx);
        return truthy(a) ? evaluate(node.b, scope, ctx) : a;
      }
      if (node.op === '||') {
        const a = evaluate(node.a, scope, ctx);
        return truthy(a) ? a : evaluate(node.b, scope, ctx);
      }
      if (node.op === '??') {
        const a = evaluate(node.a, scope, ctx);
        return a ?? evaluate(node.b, scope, ctx);
      }
      const a = evaluate(node.a, scope, ctx) as never;
      const b = evaluate(node.b, scope, ctx) as never;
      switch (node.op) {
        case '==':
          return a === b;
        case '!=':
          return a !== b;
        case '<':
          return a < b;
        case '<=':
          return a <= b;
        case '>':
          return a > b;
        case '>=':
          return a >= b;
        case '+': {
          const r = (a as string) + (b as string);
          if (typeof r === 'string' && r.length > 1_000_000) throw new ExprError('string too long');
          return r;
        }
        case '-':
          return (a as number) - (b as number);
        case '*':
          return (a as number) * (b as number);
        case '/':
          return (a as number) / (b as number);
        case '%':
          return (a as number) % (b as number);
      }
      throw new ExprError(`unknown operator ${node.op}`);
    }
    case 'cond':
      return truthy(evaluate(node.c, scope, ctx)) ? evaluate(node.a, scope, ctx) : evaluate(node.b, scope, ctx);
    case 'fn':
      return lambda(node.params, node.body, scope, '');
  }
}

/** Call a function value with the language's rules (used by stdlib callbacks too). */
export function callFn(fn: unknown, args: unknown[], ctx: EvalContext): unknown {
  if (!isFn(fn)) throw new ExprError(`expected a function, got ${describe(fn)}`);
  tick(ctx);
  if (fn.kind === 'builtin') return fn.impl(ctx, args);
  const s = fn.scope.child();
  fn.params.forEach((name, i) => s.set(name, args[i]));
  return evaluate(fn.body, s, ctx);
}

// ---------------------------------------------------------------- templates

const cache = new Map<string, Node>();
/** Parse once per source string (plugins evaluate the same expressions many times). */
export function compile(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    n = parse(src);
    if (cache.size > 5000) cache.clear();
    cache.set(src, n);
  }
  return n;
}

/** Split a template string into literal text and `${ expr }` parts (braces may nest). */
export function templateParts(s: string): (string | { expr: string })[] {
  const parts: (string | { expr: string })[] = [];
  let i = 0;
  let text = '';
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      let quote: string | null = null;
      for (; j < s.length && depth > 0; j++) {
        const c = s[j];
        if (quote) {
          if (c === '\\') j++;
          else if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      if (depth > 0) throw new ExprError('unclosed ${ in template', s);
      if (text) parts.push(text);
      text = '';
      parts.push({ expr: s.slice(i + 2, j - 1) });
      i = j;
    } else text += s[i++];
  }
  if (text) parts.push(text);
  return parts;
}

export function stringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Evaluate a template: one bare `${ }` keeps the value's type, anything else becomes a string. */
export function template(s: string, scope: Scope, ctx: EvalContext): unknown {
  if (!s.includes('${')) return s;
  const parts = templateParts(s);
  if (parts.length === 1 && typeof parts[0] !== 'string') return evaluate(compile(parts[0]!.expr.trim()), scope, ctx);
  return parts.map((p) => (typeof p === 'string' ? p : stringify(evaluate(compile(p.expr.trim()), scope, ctx)))).join('');
}

/** Deep-evaluate templates inside a YAML value (objects, lists, strings). */
export function templateDeep(v: unknown, scope: Scope, ctx: EvalContext): unknown {
  if (typeof v === 'string') return template(v, scope, ctx);
  if (Array.isArray(v)) return v.map((x) => templateDeep(x, scope, ctx));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, templateDeep(x, scope, ctx)]));
  return v;
}

/** Every expression source in a template string (for validation). */
export function templateExprs(s: string): string[] {
  return s.includes('${') ? templateParts(s).flatMap((p) => (typeof p === 'string' ? [] : [p.expr.trim()])) : [];
}
