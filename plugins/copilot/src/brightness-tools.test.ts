import { expect, test } from 'bun:test';
import type { PhoneBrightness, PhoneBrightnessChange, PhoneService, ToolContext } from '@pku-harness/sdk';
import { createBrightnessTools } from './brightness-tools';

const sessionId = '11111111-1111-4111-8111-111111111111';
const before: PhoneBrightness = { displayId: 0, percent: 40, linear: 0.1, minimum: 0, maximum: 1, adaptive: true };

function fixture() {
  const reads: unknown[][] = [];
  const writes: unknown[][] = [];
  const signal = new AbortController().signal;
  let result: PhoneBrightnessChange = {
    before, after: { ...before, percent: 70, linear: 0.3, adaptive: false }, requestedPercent: 70, verified: true,
  };
  const phone = {
    readBrightness: async (...args: unknown[]) => { reads.push(args); return before; },
    setBrightness: async (...args: unknown[]) => { writes.push(args); return result; },
  } as unknown as PhoneService;
  const context = { actor: 'agent', signal } as ToolContext;
  const tools = createBrightnessTools(() => phone);
  return { tools, context, reads, writes, signal, phone, setResult: (next: PhoneBrightnessChange) => { result = next; } };
}

test('brightness tools retain read/write approval classification and forward the run signal', async () => {
  const f = fixture();
  expect(f.tools.readBrightness.effect).toBe('read');
  expect(f.tools.setBrightness.effect).toBe('write');
  expect(await f.tools.readBrightness.execute(f.tools.readBrightness.input.parse({ sessionId }), f.context)).toEqual(before);
  expect(f.reads).toEqual([[sessionId, f.signal]]);
  const result = await f.tools.setBrightness.execute(f.tools.setBrightness.input.parse({ sessionId, percent: 70, adaptive: false }), f.context);
  expect(f.writes).toEqual([[sessionId, 70, false, f.signal]]);
  expect(result).toMatchObject({ before: { adaptive: true }, after: { percent: 70, adaptive: false }, verified: true });
});

test('omitted adaptive mode remains omitted; enabling it is forwarded explicitly', async () => {
  const f = fixture();
  await f.tools.setBrightness.execute(f.tools.setBrightness.input.parse({ sessionId, percent: 70 }), f.context);
  await f.tools.setBrightness.execute(f.tools.setBrightness.input.parse({ sessionId, percent: 70, adaptive: true }), f.context);
  expect(f.writes).toEqual([[sessionId, 70, undefined, f.signal], [sessionId, 70, true, f.signal]]);
});

test('brightness inputs reject out-of-range values and arbitrary setting commands before dispatch', () => {
  const f = fixture();
  for (const percent of [-1, 101, NaN, Infinity, -Infinity, '70', null]) {
    expect(f.tools.setBrightness.input.safeParse({ sessionId, percent }).success).toBe(false);
  }
  expect(f.tools.setBrightness.input.safeParse({ sessionId, percent: 70, key: 'airplane_mode_on' }).success).toBe(false);
  expect(f.tools.setBrightness.input.safeParse({ sessionId, percent: 70, adaptive: 'false' }).success).toBe(false);
  expect(f.tools.readBrightness.input.safeParse({ sessionId: 'stale-or-invented' }).success).toBe(false);
  expect(f.writes).toEqual([]);
});

test('unverified readback remains unverified and a different display is rejected', async () => {
  const f = fixture();
  f.setResult({ before, after: before, requestedPercent: 70, verified: false });
  expect(await f.tools.setBrightness.execute({ sessionId, percent: 70 }, f.context)).toMatchObject({ verified: false, after: { percent: 40 } });
  f.phone.readBrightness = async () => ({ ...before, displayId: 8 } as unknown as PhoneBrightness);
  await expect(f.tools.readBrightness.execute({ sessionId }, f.context)).rejects.toThrow();
});
