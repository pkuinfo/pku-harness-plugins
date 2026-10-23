import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { beijingTimestamp, nonce, signFields, signingString } from './recharge';

const sha256 = async (s: string) => createHash('sha256').update(s).digest('hex');

describe('recharge signing (pkucli api.rs sign_params)', () => {
  const fields = {
    feeitemid: '401',
    appid: '56321',
    tranamt: '100',
    source: 'app',
    yktcard: '123456',
    synAccessSource: 'h5',
    abstracts: JSON.stringify({ type: 'recharge' }),
    'synjones-auth': 'bearer x.y.z',
    empty: '',
  };

  test('sorted non-empty pairs, SIGN excluded, secret last', () => {
    const s = signingString({ ...fields, SIGN: 'old', APP_ID: '56321', TIMESTAMP: '20261019213000', SIGN_TYPE: 'SHA256', NONCE: 'abc' });
    expect(s.startsWith('APP_ID=56321&NONCE=abc&SIGN_TYPE=SHA256&TIMESTAMP=20261019213000&abstracts=')).toBe(true);
    expect(s).not.toContain('empty=');
    expect(s).not.toContain('SIGN=old');
    expect(s.endsWith('SECRET_KEY=0osTIhce7uPvDKHz6aa67bhCukaKoYl4')).toBe(true);
  });

  test('matches an independent SHA-256 of the same string (upper hex)', async () => {
    const now = Date.UTC(2026, 9, 19, 13, 30, 0); // 21:30:00 in Beijing
    const signed = await signFields(fields, sha256, now);
    expect(signed.TIMESTAMP).toBe('20261019213000');
    const expected = (await sha256(signingString({ ...signed }))).toUpperCase();
    expect(signed.SIGN).toBe(expected);
    // Same as Python hashlib over the pkucli string with NONCE=abc:
    const fixed = { ...fields, APP_ID: '56321', TIMESTAMP: '20261019213000', SIGN_TYPE: 'SHA256', NONCE: 'abc' };
    expect((await sha256(signingString(fixed))).toUpperCase()).toBe('EE0D2A1CBE422DC32665D8FACC1F71F73F9864258C285536D9E289AC85A9EC75');
  });

  test('timestamp is Beijing time regardless of device zone; nonce shape', () => {
    expect(beijingTimestamp(Date.UTC(2026, 11, 31, 16, 0, 1))).toBe('20270101000001');
    expect(nonce()).toMatch(/^[0-9a-z]{11}$/);
  });
});
