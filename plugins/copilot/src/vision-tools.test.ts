import { expect, test } from 'bun:test';
import { MODEL_IMAGE_KEY, takeModelImage, type KV, type PhoneLook, type PhoneService, type ToolContext } from '@pku-harness/sdk';
import { saveCopilotVision } from './preferences';
import { createVisionTools, NO_IMAGE_MODEL, SCREENSHOTS_OFF } from './vision-tools';

const sessionId = '11111111-1111-4111-8111-111111111111';
const shot: PhoneLook = {
  screen: { sessionId, snapshotId: `${sessionId}:3`, packageName: 'com.tencent.mm', width: 1080, height: 2400, protected: false, changedDuringRead: false, elements: [], handoff: false },
  image: { data: 'aGVsbG8=', mediaType: 'image/jpeg', width: 324, height: 720 },
};

function fixture(opts: { screenshots?: boolean; acceptsImages?: boolean; actor?: ToolContext['actor'] } = {}) {
  const values = new Map<string, unknown>();
  const kv: KV = { get: async <T>(key: string) => values.get(key) as T | undefined, set: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); } };
  const looks: unknown[][] = [];
  const executed: unknown[][] = [];
  let next = shot;
  const phone = {
    look: async (...args: unknown[]) => { looks.push(args); return next; },
    execute: async (...args: unknown[]) => { executed.push(args); return { ok: true, screen: shot.screen }; },
    assessAt: async () => ({ effect: 'write', target: { label: '(10, 20)', context: 'com.tencent.mm' } }),
  } as unknown as PhoneService;
  const context = { actor: opts.actor ?? 'agent', kv, signal: new AbortController().signal, effect: 'write', services: { phone },
    turn: { tainted: false, acceptsImages: opts.acceptsImages ?? true } } as unknown as ToolContext;
  const tools = createVisionTools(() => phone);
  const ready = opts.screenshots === false ? Promise.resolve() : saveCopilotVision(kv, { screenshots: true }).then(() => {});
  return { tools, context, looks, executed, ready, phone, setShot: (value: PhoneLook) => { next = value; } };
}

test('look is off unless the user turned screenshots on, and needs a model that reads images', async () => {
  const off = fixture({ screenshots: false });
  await expect(off.tools.look.execute({ sessionId }, off.context)).rejects.toThrow(SCREENSHOTS_OFF);
  const blind = fixture({ acceptsImages: false });
  await blind.ready;
  await expect(blind.tools.look.execute({ sessionId }, blind.context)).rejects.toThrow(NO_IMAGE_MODEL);
  const scheduled = fixture({ actor: 'scheduler' });
  await scheduled.ready;
  await expect(scheduled.tools.look.execute({ sessionId }, scheduled.context)).rejects.toThrow('chat reply');
  expect([...off.looks, ...blind.looks, ...scheduled.looks]).toEqual([]);
});

test('look returns the coordinate space and hands the image to the host, not as output', async () => {
  const f = fixture();
  await f.ready;
  const result = await f.tools.look.execute({ sessionId }, f.context);
  const { output, image } = takeModelImage(result);
  expect(image).toEqual({ data: 'aGVsbG8=', mediaType: 'image/jpeg' });
  expect(output).toMatchObject({ snapshotId: `${sessionId}:3`, width: 324, height: 720, packageName: 'com.tencent.mm' });
  expect(MODEL_IMAGE_KEY in (output as object)).toBe(false);
  f.setShot({ ...shot, screen: { ...shot.screen, protected: true } });
  await expect(f.tools.look.execute({ sessionId }, f.context)).rejects.toThrow('protected');
});

test('point actions always ask, carry the approved effect and the AI-stated target', async () => {
  const f = fixture();
  await f.ready;
  expect(f.tools.tapAt.alwaysAsk).toBe(true);
  expect(f.tools.typeAt.alwaysAsk).toBe(true);
  expect(f.tools.tapAt.effect).toBe('write');
  const raw = { sessionId, snapshotId: `${sessionId}:3`, x: 10, y: 20, target: '发送' };
  const input = f.tools.tapAt.input.parse(raw);
  expect(await f.tools.tapAt.resolveEffect!(input, f.context.services)).toEqual({ effect: 'write', target: { label: '“发送” (10, 20)', context: 'com.tencent.mm' } });
  await f.tools.tapAt.execute(input, f.context);
  expect(f.executed[0]!.slice(0, 3)).toEqual([sessionId, 'tapAt', { snapshotId: `${sessionId}:3`, x: 10, y: 20, authorizedEffect: 'write' }]);
  expect(() => f.tools.tapAt.input.parse({ ...raw, x: 1.5 })).toThrow();
  expect(() => f.tools.tapAt.input.parse({ ...raw, target: '' })).toThrow();
  const typed = f.tools.typeAt.input.parse({ ...raw, target: '输入框', text: '你好' });
  await f.tools.typeAt.execute(typed, f.context);
  expect(f.executed[1]![2]).toEqual({ snapshotId: `${sessionId}:3`, x: 10, y: 20, text: '你好', authorizedEffect: 'write' });
});
