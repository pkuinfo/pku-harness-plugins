import { expect, test } from 'bun:test';
import { LatestPhoneRead } from './latest-read';

test('a delayed preview cannot replace a newer stopped-session status', () => {
  const reads = new LatestPhoneRead();
  const oldPreview = reads.begin();
  reads.invalidate();
  const afterStop = reads.begin();
  expect(afterStop()).toBe(true);
  expect(oldPreview()).toBe(false);
});

test('new reads supersede old reads and disposal revokes the last result', () => {
  const reads = new LatestPhoneRead();
  const first = reads.begin();
  const second = reads.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
  reads.invalidate();
  expect(second()).toBe(false);
});
