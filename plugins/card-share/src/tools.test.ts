import { afterEach, describe, expect, test } from 'bun:test';
import type { ToolContext } from '@pku-harness/sdk';

import { DRAFT_KEY, MOCK_KEY, resetShareManager, shareManager } from './manager';
import { fakeCloud, FakeClock, flush, memoryKV } from './test/fakes';
import { tools } from './tools';

function ctx() {
  const clock = new FakeClock(Date.now());
  const { cloud, channels } = fakeCloud(clock);
  const kv = memoryKV();
  const c = { pluginId: 'card-share', actor: 'agent', kv, cloud, services: { campus: {} } } as unknown as ToolContext;
  return { c, kv, channels };
}

afterEach(() => resetShareManager());

describe('card-share tools', () => {
  test('start only saves a draft and asks the user', async () => {
    const { c, kv, channels } = ctx();
    const r = (await tools.start.execute({ ttl: '2h', capYuan: 30 }, c)) as { status: string };
    expect(r.status).toBe('awaiting_user');
    expect(await kv.get(DRAFT_KEY)).toMatchObject({ ttl: '2h', capYuan: 30 });
    expect(channels).toHaveLength(0);
  });

  test('list never exposes the link, a code, the PIN or the name; revoke stops', async () => {
    const { c, kv, channels } = ctx();
    await kv.set(MOCK_KEY, true);
    const m = shareManager({ kv, services: c.services, cloud: c.cloud, mock: true });
    const s = await m.start({ ttlS: 600, capYuan: 50, pin: '97531', name: { full: '王小明', hidden: [1] } });
    channels[0]!.join();
    channels[0]!.say({ t: 'gate', pin: '97531', name: '小' });
    await flush();
    const code = channels[0]!.framesOf('code')[0].code as string;
    const out = JSON.stringify(await tools.list.execute({}, c));
    for (const secret of [code, '97531', '王小明', '小明', `#k=`]) expect(out).not.toContain(secret);
    expect(out).toContain(s.id);
    expect(await tools.revoke.execute({}, c)).toEqual({ stopped: [s.id] });
    expect(channels[0]!.closed).toBe(true);
  });
});
