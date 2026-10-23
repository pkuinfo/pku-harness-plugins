import { describe, expect, test } from 'bun:test';

import { gatesOf, parseMeta, parseOwnerFrame, parseViewerFrame } from './protocol';
import { shareMetaOf } from './session';

describe('frame schemas', () => {
  test('viewer frames', () => {
    expect(parseViewerFrame({ t: 'want' })).toEqual({ t: 'want' });
    expect(parseViewerFrame({ t: 'gate', pin: '1234', name: '小' })).toEqual({ t: 'gate', pin: '1234', name: '小' });
    expect(parseViewerFrame({ t: 'gate', pin: '12' })).toBeUndefined();
    expect(parseViewerFrame({ t: 'gate', pin: 'abcd' })).toBeUndefined();
    expect(parseViewerFrame({ t: 'code', code: 'x' })).toBeUndefined();
    expect(parseViewerFrame('want')).toBeUndefined();
  });
  test('owner frames', () => {
    const code = { t: 'code' as const, code: '1234567890', issuedAt: 1, seq: 1, balance: 12.5, refreshS: 25 };
    expect(parseOwnerFrame(code)).toEqual(code);
    expect(parseOwnerFrame({ ...code, seq: 0 })).toBeUndefined();
    expect(parseOwnerFrame({ ...code, code: '' })).toBeUndefined();
    expect(parseOwnerFrame({ t: 'gate_result', ok: false, remaining: 3, wrong: ['pin'] })).toBeDefined();
    expect(parseOwnerFrame({ t: 'gate_result', ok: false, wrong: ['face'] })).toBeUndefined();
    expect(parseOwnerFrame({ t: 'revoked', reason: 'cap' })).toEqual({ t: 'revoked', reason: 'cap' });
    expect(parseOwnerFrame({ t: 'revoked', reason: 'bored' })).toBeUndefined();
    expect(parseOwnerFrame({ t: 'status', state: 'gate', need: ['name', 'pin'], expiresAt: 5 })).toBeDefined();
    expect(parseOwnerFrame({ t: 'status', state: 'nope', expiresAt: 5 })).toBeUndefined();
  });
  test('meta never carries the name or the PIN', () => {
    const meta = shareMetaOf({ ttlS: 600, capYuan: 50, pin: '2468', name: { full: '王小明', hidden: [1] } });
    expect(meta).toEqual({ v: 1, kind: 'card-share', nameHint: '王_明', pin: true, capYuan: 50 });
    expect(JSON.stringify(meta)).not.toContain('2468');
    expect(JSON.stringify(meta)).not.toContain('小');
    expect(parseMeta(meta)).toEqual(meta);
    expect(gatesOf(meta)).toEqual(['name', 'pin']);
    const open = shareMetaOf({ ttlS: 600, capYuan: null, pin: null, name: null });
    expect(gatesOf(open)).toEqual([]);
    expect(parseMeta({ ...open, v: 2 })).toBeUndefined();
  });
});
