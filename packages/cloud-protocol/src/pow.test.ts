import { describe, expect, test } from 'bun:test';

import { leadingZeroBits, powHash, solvePow, verifyPow } from './pow';

const c = { salt: 'salt1', signPub: 'A'.repeat(43), boxPub: 'B'.repeat(43) };

describe('proof of work', () => {
  test('leading zero bits', () => {
    expect(leadingZeroBits(Uint8Array.from([0x80]))).toBe(0);
    expect(leadingZeroBits(Uint8Array.from([0x01]))).toBe(7);
    expect(leadingZeroBits(Uint8Array.from([0, 0x40]))).toBe(9);
    expect(leadingZeroBits(new Uint8Array(4))).toBe(32);
  });
  test('solve then verify at low difficulty', async () => {
    const { nonce, attempts } = await solvePow(c, 10);
    expect(attempts).toBeGreaterThan(0);
    expect(verifyPow(c, nonce, 10)).toBe(true);
    expect(leadingZeroBits(powHash(c, nonce))).toBeGreaterThanOrEqual(10);
    // bound to the keys and salt
    expect(verifyPow({ ...c, signPub: 'C'.repeat(43) }, nonce, 10) && verifyPow({ ...c, salt: 'salt2' }, nonce, 10)).toBe(false);
  });
  test('difficulty 0 accepts any canonical nonce; malformed nonces never verify', () => {
    expect(verifyPow(c, '0', 0)).toBe(true);
    for (const n of ['', '01', '-1', '1.5', '1e3', 'abc', '1234567890123456']) expect(verifyPow(c, n, 0)).toBe(false);
    expect(verifyPow(c, '0', -1)).toBe(false);
  });
  test('refuses absurd difficulty, honours abort and maxAttempts', async () => {
    await expect(solvePow(c, 40)).rejects.toThrow();
    const ac = new AbortController();
    ac.abort();
    await expect(solvePow(c, 20, { signal: ac.signal })).rejects.toThrow('aborted');
    await expect(solvePow(c, 24, { maxAttempts: 10 })).rejects.toThrow();
  });
});
