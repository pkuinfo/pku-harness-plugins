import { expect, test } from 'bun:test';
import { MODEL_IMAGE_KEY, takeModelImage, withModelImage } from './model-image';

test('the image is split off the tool output', () => {
  const result = withModelImage({ snapshotId: 's:1', width: 360 }, { data: 'aGVsbG8=', mediaType: 'image/jpeg' });
  const { output, image } = takeModelImage(result);
  expect(output).toEqual({ snapshotId: 's:1', width: 360 });
  expect(MODEL_IMAGE_KEY in (output as object)).toBe(false);
  expect(image).toEqual({ data: 'aGVsbG8=', mediaType: 'image/jpeg' });
});

test('results without an image pass through unchanged', () => {
  const plain = { ok: true };
  expect(takeModelImage(plain).output).toBe(plain);
  expect(takeModelImage('text').output).toBe('text');
  expect(takeModelImage(null).image).toBeUndefined();
});

test('a malformed image is dropped, never passed on', () => {
  for (const bad of [{ data: 'x y', mediaType: 'image/jpeg' }, { data: 'aGk=', mediaType: 'text/html' }, { data: '', mediaType: 'image/png' }, 'aGk=']) {
    const { output, image } = takeModelImage({ a: 1, [MODEL_IMAGE_KEY]: bad });
    expect(image).toBeUndefined();
    expect(output).toEqual({ a: 1 });
  }
});
