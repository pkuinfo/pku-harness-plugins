/**
 * The finance document's request-body encoding (plugins/finance/shared.yaml, after pkucli
 * crates/cwfw/src/encrypt.rs): every key and value is encode(encode2(x)), which the portal decodes
 * with the inverse below (encrypt.rs `decrypt_for_test`). Recorded tests can't see inside the
 * encrypted bodies, so the encoding is checked here against Buffer.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDocument } from '../packages/sdk/src';
import { callFn, compile, evaluate, lambda, Scope, type EvalContext } from '../packages/sdk/src/lang/expr';
import { STDLIB } from '../packages/sdk/src/lang/stdlib';

const dir = join(import.meta.dir, 'finance');
const doc = await loadDocument(async (p) => readFileSync(join(dir, p), 'utf8'));
const tool = doc.tools.rewards!;

function ev(src: string, now = Date.parse('2026-10-20T12:00:00+08:00')) {
  const ctx = { budget: { ops: 1e6 }, stdlib: STDLIB, now } as EvalContext & { now: number };
  ctx.call = (fn, args) => callFn(fn, args, ctx);
  const root = new Scope();
  root.set('now', now);
  for (const [k, v] of Object.entries(tool.constants ?? {})) root.set(k, v);
  for (const [k, s] of Object.entries(tool.functions ?? {})) {
    const n = compile(s) as unknown as { params: string[]; body: never };
    root.set(k, lambda(n.params, n.body, root, s));
  }
  return { value: evaluate(compile(src), root, ctx), ops: 1e6 - ctx.budget.ops };
}

/** Reference mirror (jquery.picList.js encode): swap b[t] ↔ b[len-1-t] for even t < len/2. */
function mirror(s: string) {
  const c = s.split('');
  for (let t = 0; t < Math.floor(c.length / 2); t += 2) [c[t], c[c.length - 1 - t]] = [c[c.length - 1 - t]!, c[t]!];
  return c.join('');
}
const decrypt = (s: string) => {
  const inner = Buffer.from(mirror(s.replace(/eEc$/, '')), 'base64').toString('utf8');
  return Buffer.from(inner.slice(0, -5), 'base64').toString('utf8');
};

describe('finance: cwfw request encoding', () => {
  test('mirror matches the reference for every length', () => {
    expect(ev("mirror('0123456789')").value).toBe('9173546280');
    for (let n = 0; n < 40; n++) {
      const s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.slice(0, n);
      expect(ev(`mirror('${s}')`).value).toBe(mirror(s));
    }
  });

  test('encode with a known salt (encrypt.rs)', () => {
    expect(ev("mirror(base64('abc' + 'AAAAA')) + 'eEc'").value).toBe(`${mirror(Buffer.from('abcAAAAA').toString('base64'))}eEc`);
  });

  test('round trip, salt from the SALT charset, cost independent of length', () => {
    for (const s of ['_search', 'false', '50', 'WF_CWBS', '2200011523', '查询', '个人酬金查询', '😀x', '{"a":"b"}'.repeat(200)]) {
      const { value, ops } = ev(`encrypt(${JSON.stringify(s)}, 3)`);
      expect(decrypt(value as string)).toBe(s);
      expect(ops).toBeLessThan(250);
    }
    const salt = ev('salt(4)').value as string;
    expect(salt).toMatch(/^[poiuytrewqasdfghjklmnbvcxzQWERTYUIOPLKJHGFDSAZXCVBNM1-9]{5}$/);
    expect(ev('salt(4)', Date.parse('2026-10-20T12:00:07+08:00')).value).not.toBe(salt);
  });

  test('encryptForm encrypts every key and value, `a` first', () => {
    const body = ev("wfBody('2200011523', [['projid', 'WF_CWBS'], ['winno', '5609']])").value as string;
    expect(body.split('&').map((p) => p.split('=').map((x) => decrypt(decodeURIComponent(x))))).toEqual([
      ['a', '2200011523'],
      ['projid', 'WF_CWBS'],
      ['winno', '5609'],
    ]);
  });
});
