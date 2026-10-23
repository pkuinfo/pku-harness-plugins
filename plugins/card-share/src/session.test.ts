import { beforeEach, describe, expect, test } from 'bun:test';

import { MAX_GATE_FAILURES } from './gates';
import { ShareManager, SHARES_KEY } from './manager';
import { CODE_REFRESH_MS, ShareSession, type ShareConfig, type ShareRecord } from './session';
import { MockSource, NotDigitalError } from './source';
import { fakeCloud, FakeClock, flush, memoryKV, type FakeChannel } from './test/fakes';

const base: ShareConfig = { ttlS: 1800, capYuan: 50, pin: null, name: null };

function setup(opts: { kick?: boolean } = {}) {
  const clock = new FakeClock();
  const { cloud, channels } = fakeCloud(clock, opts);
  const source = new MockSource({ now: clock.now });
  const saved: ShareRecord[] = [];
  const ongoing: { starts: number; stops: number; bodies: string[]; onStop?: () => void } = { starts: 0, stops: 0, bodies: [] };
  const deps = {
    cloud,
    source,
    clock,
    persist: (r: ShareRecord) => void saved.push(JSON.parse(JSON.stringify(r))),
    ongoing: {
      start: (o: { body?: string; onStop?: () => void }) => {
        ongoing.starts++;
        ongoing.onStop = o.onStop;
        return { update: (p: { body?: string }) => void (p.body && ongoing.bodies.push(p.body)), stop: () => void ongoing.stops++ };
      },
    },
    ongoingText: { title: 't', stop: 's', body: (r: ShareRecord) => `codes ${r.codesIssued}` },
  };
  return { clock, cloud, channels, source, saved, ongoing, deps };
}

async function started(config: Partial<ShareConfig> = {}, opts: { kick?: boolean } = {}) {
  const env = setup(opts);
  const session = await ShareSession.start(env.deps, { ...base, ...config });
  const ch = env.channels[0]!;
  return { ...env, session, ch };
}

describe('ShareSession', () => {
  test('opens a 1-viewer channel with sealed-able meta and starts the ongoing notification', async () => {
    const { ch, session, ongoing } = await started({ pin: '2468', name: { full: '王小明', hidden: [1] } });
    expect(ch.opts).toMatchObject({ ttlS: 1800, maxPeers: 1, page: 'view', meta: { nameHint: '王_明', pin: true, capYuan: 50 } });
    expect(JSON.stringify(ch.opts.meta)).not.toContain('2468');
    expect(session.record).toMatchObject({ status: 'active', pin: true, nameHint: '王_明', codesIssued: 0 });
    expect(ongoing.starts).toBe(1);
    expect(JSON.stringify(session.link)).toBe('"[secret link]"');
  });

  test('no gates: a joining viewer gets a code at once and every 25 s', async () => {
    const { ch, clock, session } = await started();
    ch.join();
    await flush();
    expect(ch.framesOf('status', 'peer-1')[0]).toMatchObject({ state: 'live' });
    expect(ch.framesOf('code', 'peer-1')).toHaveLength(1);
    await clock.advance(CODE_REFRESH_MS);
    await clock.advance(CODE_REFRESH_MS);
    const codes = ch.framesOf('code', 'peer-1');
    expect(codes.map((c) => c.seq)).toEqual([1, 2, 3]);
    expect(new Set(codes.map((c) => c.code)).size).toBe(3);
    expect(session.record.codesIssued).toBe(3);
  });

  test('want: a fresh code, but the same one within 5 s', async () => {
    const { ch, clock, source } = await started();
    ch.join();
    await flush();
    ch.say({ t: 'want' });
    await flush();
    expect(source.minted).toBe(1);
    expect(ch.framesOf('code')).toHaveLength(2);
    await clock.advance(6000);
    ch.say({ t: 'want' });
    await flush();
    expect(source.minted).toBe(2);
  });

  test('gates: wrong answers count down, the right ones unlock codes', async () => {
    const { ch, session } = await started({ pin: '2468', name: { full: '王小明', hidden: [1, 2] } });
    ch.join();
    await flush();
    expect(ch.framesOf('status')[0]).toMatchObject({ state: 'gate', need: ['name', 'pin'] });
    expect(ch.framesOf('code')).toHaveLength(0);
    ch.say({ t: 'want' });
    await flush();
    expect(ch.framesOf('code')).toHaveLength(0);
    ch.say({ t: 'gate', name: '小明', pin: '1111' });
    await flush();
    expect(ch.framesOf('gate_result')[0]).toEqual({ t: 'gate_result', ok: false, remaining: MAX_GATE_FAILURES - 1, wrong: ['pin'] });
    ch.say({ t: 'gate', name: '小明', pin: '2468' });
    await flush();
    expect(ch.framesOf('gate_result')[1]).toEqual({ t: 'gate_result', ok: true });
    expect(ch.framesOf('code')).toHaveLength(1);
    expect(session.record.viewer?.verified).toBe(true);
  });

  test('lockout: 5 wrong answers close the share', async () => {
    const { ch, session, ongoing } = await started({ pin: '2468' });
    ch.join();
    await flush();
    for (let i = 0; i < MAX_GATE_FAILURES; i++) {
      ch.say({ t: 'gate', pin: '0000' });
      await flush();
    }
    expect(ch.framesOf('gate_result').map((g) => g.remaining)).toEqual([4, 3, 2, 1, 0]);
    expect(session.record).toMatchObject({ status: 'ended', endReason: 'locked', failures: 5 });
    expect(session.record.secret).toBeUndefined();
    expect(ch.framesOf('revoked')[0]).toEqual({ t: 'revoked', reason: 'locked' });
    expect(ch.closed).toBe(true);
    expect(ongoing.stops).toBe(1);
    ch.say({ t: 'gate', pin: '2468' });
    await flush();
    expect(ch.framesOf('code')).toHaveLength(0);
  });

  test('frames from anyone but the claimed viewer are ignored', async () => {
    const { ch, source } = await started();
    ch.join('peer-1');
    await flush();
    ch.say({ t: 'want' }, 'intruder');
    ch.say({ t: 'bogus' });
    await flush();
    expect(source.minted).toBe(1);
    expect(ch.sent.every((x) => x.to === 'peer-1' || x.to === '*')).toBe(true);
  });

  test('viewer leaves: codes stop; back: codes resume', async () => {
    const { ch, clock, source } = await started();
    ch.join();
    await flush();
    ch.emit({ type: 'leave', peerId: 'peer-1', at: clock.now() });
    await clock.advance(CODE_REFRESH_MS * 3);
    expect(source.minted).toBe(1);
    ch.join();
    await flush();
    expect(source.minted).toBe(2);
  });

  test('spend cap: polled after codes, closes the share when reached', async () => {
    const { ch, clock, source, session } = await started({ capYuan: 20 });
    ch.join();
    await flush();
    await clock.advance(10_000);
    source.pay(12.5);
    await clock.advance(10_000); // +20 s check
    expect(session.record.spent).toBe(12.5);
    expect(session.active).toBe(true);
    source.pay(9);
    await clock.advance(40_000); // +60 s check
    expect(session.record).toMatchObject({ status: 'ended', endReason: 'cap', spent: 21.5 });
    expect(ch.framesOf('status').at(-1)).toMatchObject({ state: 'capped' });
    expect(ch.framesOf('revoked').at(-1)).toEqual({ t: 'revoked', reason: 'cap' });
    const minted = source.minted;
    await clock.advance(CODE_REFRESH_MS * 4);
    expect(source.minted).toBe(minted);
  });

  test('spend cap: background poll every 2 min even without codes', async () => {
    const { clock, source, session } = await started({ capYuan: 5 });
    source.pay(6);
    await clock.advance(119_000);
    expect(session.active).toBe(true);
    await clock.advance(2_000);
    expect(session.record.endReason).toBe('cap');
  });

  test('expiry closes the share; extend pushes it back', async () => {
    const { ch, clock, session } = await started({ ttlS: 600 });
    await clock.advance(500_000);
    await session.extend(1200);
    expect(ch.expiresAt).toBe(clock.now() + 1_200_000);
    await clock.advance(600_000);
    expect(session.active).toBe(true);
    await clock.advance(700_000);
    expect(session.record).toMatchObject({ status: 'ended', endReason: 'expired' });
  });

  test('relay closes the channel → ended without sending', async () => {
    const { ch, session } = await started();
    ch.emit({ type: 'closed', reason: 'expired' });
    await flush();
    expect(session.record.endReason).toBe('expired');
    expect(ch.framesOf('revoked')).toHaveLength(0);
  });

  test('stop from the notification ends the share', async () => {
    const { ongoing, session, ch } = await started();
    ongoing.onStop?.();
    await flush();
    expect(session.record.endReason).toBe('owner');
    expect(ch.closed).toBe(true);
  });

  test('not in 数字卡 mode: paused status, retried on the next tick', async () => {
    const { ch, clock, source, session } = await started();
    source.failNext = new NotDigitalError('实体卡');
    ch.join();
    await flush();
    expect(session.record.paused).toContain('数字卡');
    expect(ch.framesOf('status').at(-1)).toMatchObject({ state: 'paused' });
    await clock.advance(CODE_REFRESH_MS);
    expect(ch.framesOf('code')).toHaveLength(1);
    expect(session.record.paused).toBeUndefined();
  });

  test('codes are never persisted', async () => {
    const { ch, saved } = await started();
    ch.join();
    await flush();
    const code = ch.framesOf('code')[0].code as string;
    expect(JSON.stringify(saved)).not.toContain(code);
  });
});

describe('ShareManager', () => {
  let env: ReturnType<typeof setup>;
  let kv: ReturnType<typeof memoryKV>;
  beforeEach(() => {
    env = setup();
    kv = memoryKV();
  });
  const make = (kick = false) => {
    const e = kick ? setup({ kick: true }) : env;
    return { m: new ShareManager({ kv, cloud: e.cloud, source: e.source, clock: e.clock }), e };
  };

  test('persists shares and re-attaches active ones after a restart', async () => {
    const { m } = make();
    const s = await m.start(base);
    await flush();
    const saved = (await kv.get<ShareRecord[]>(SHARES_KEY))!;
    expect(saved.map((r) => r.id)).toEqual([s.id]);
    // "restart": a new manager over the same kv and cloud
    const m2 = new ShareManager({ kv, cloud: env.cloud, source: env.source, clock: env.clock });
    await m2.load();
    expect(m2.get(s.id)?.active).toBe(true);
    const ch = env.channels[0]! as FakeChannel;
    ch.join();
    await flush();
    expect(ch.framesOf('code')).toHaveLength(2); // both sessions listen; the old one is gone in a real restart
  });

  test('a missing channel on load ends the share', async () => {
    await kv.set(SHARES_KEY, [{ id: 'gone000001', createdAt: 0, expiresAt: env.clock.now() + 1e6, status: 'active', capYuan: 50, pin: false, viewer: null, viewersSeen: 0, failures: 0, codesIssued: 0, spent: 0, payments: [], source: 'mock', secret: { pin: null, name: null } }]);
    const { m } = make();
    await m.load();
    expect(m.list()[0]).toMatchObject({ status: 'ended', endReason: 'server' });
    expect(m.list()[0]!.secret).toBeUndefined();
  });

  test('stopAll and history order', async () => {
    const { m } = make();
    const a = await m.start(base);
    env.clock.t += 1000;
    const b = await m.start(base);
    expect(m.list().map((r) => r.id)).toEqual([b.id, a.id]);
    expect(await m.stopAll()).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(m.list().every((r) => r.status === 'ended')).toBe(true);
  });

  test('reset viewer without kick: a new link carrying spend and settings', async () => {
    const { m } = make();
    const a = await m.start({ ...base, pin: '2468' });
    a.record.spent = 7;
    const b = await m.resetViewer(a.id);
    expect(b!.id).not.toBe(a.id);
    expect(b!.record).toMatchObject({ spent: 7, pin: true, createdAt: a.record.createdAt });
    expect(a.record).toMatchObject({ status: 'ended', replacedBy: b!.id });
    expect(m.list().map((r) => r.id)).toEqual([b!.id]);
  });

  test('reset viewer with kick: same link, viewer dropped', async () => {
    const { m, e } = make(true);
    const a = await m.start(base);
    const ch = e.channels[0]!;
    ch.join();
    await flush();
    const same = await m.resetViewer(a.id);
    expect(same!.id).toBe(a.id);
    expect(ch.kicked).toEqual(['peer-1']);
    expect(a.record.viewer).toBeNull();
  });

  test('without a cloud client, starting fails with not_configured', async () => {
    const m = new ShareManager({ kv, source: env.source, clock: env.clock });
    await expect(m.start(base)).rejects.toMatchObject({ code: 'not_configured' });
  });
});
