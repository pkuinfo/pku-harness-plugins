import { describe, expect, test } from 'bun:test';

import { checkName, checkPin, defaultHidden, hiddenChars, isValidPin, maskName, normaliseHidden } from './gates';

// Cases from pkubdcard internal/share/share_test.go TestNameHint.
describe('masked name (port of pkubdcard)', () => {
  test('hint and hidden characters', () => {
    expect(maskName('王小明', [1, 2])).toBe('王__');
    expect(maskName('王小明', [0, 2])).toBe('_小_');
    expect(hiddenChars('王小明', [2, 0])).toBe('王明');
    expect(normaliseHidden('王小明', [2, 2, 9, -1, 0])).toEqual([0, 2]);
    expect(defaultHidden('欧阳娜娜')).toEqual([1, 2, 3]);
    expect(defaultHidden('李')).toEqual([0]);
  });
  test('answers: hidden chars or the whole name, spaces ignored', () => {
    expect(checkName('小明', '王小明', [1, 2])).toBe(true);
    expect(checkName(' 小 明 ', '王小明', [1, 2])).toBe(true);
    expect(checkName('王小明', '王小明', [1, 2])).toBe(true);
    expect(checkName('明小', '王小明', [1, 2])).toBe(false);
    expect(checkName('小', '王小明', [1, 2])).toBe(false);
    expect(checkName('', '王小明', [1])).toBe(false);
  });
  test('PIN', () => {
    expect(checkPin('2468', '2468')).toBe(true);
    expect(checkPin('24680', '2468')).toBe(false);
    expect(checkPin('', '2468')).toBe(false);
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
  });
});
