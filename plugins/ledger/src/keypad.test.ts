import { describe, expect, test } from 'bun:test';

import { amountOf, pressKey, textOf, type Key } from './keypad';

const type = (keys: string) => [...keys].reduce((t, k) => pressKey(t, (k === '<' ? 'back' : k) as Key), '');

describe('keypad', () => {
  test('digits, one point, two decimals', () => {
    expect(type('18.5')).toBe('18.5');
    expect(type('18.555')).toBe('18.55');
    expect(type('1..2')).toBe('1.2');
    expect(type('.5')).toBe('0.5');
  });
  test('no leading zeros, seven integer digits, backspace', () => {
    expect(type('007')).toBe('7');
    expect(type('123456789')).toBe('1234567');
    expect(type('18<')).toBe('1');
    expect(type('<')).toBe('');
  });
  test('amount and edit text', () => {
    expect(amountOf('0.')).toBe(0);
    expect(amountOf('18.5')).toBe(18.5);
    expect(textOf(18)).toBe('18');
    expect(textOf(18.05)).toBe('18.05');
  });
});
