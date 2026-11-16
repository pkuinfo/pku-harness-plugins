import { expect, test } from 'bun:test';
import type { PhoneElement, PhoneService, PhoneSnapshot, PhoneTapAssessment } from '@pku-harness/sdk';
import { findLabel, replayRestore } from './restore';

const sessionId = '11111111-1111-4111-8111-111111111111';
const element = (ref: string, text: string, clickable = true): PhoneElement => ({ ref, role: 'button', text, bounds: [0, 0, 10, 10], ...(clickable ? { clickable } : {}) });
const screen = (n: number, ...elements: PhoneElement[]): PhoneSnapshot => ({ sessionId, snapshotId: `${sessionId}:${n}`, packageName: 'com.tencent.mm', width: 1080, height: 2400, protected: false, changedDuringRead: false, elements, handoff: false });

/** Each tap moves to the next screen; a wait before a page has loaded shows it. */
function phoneWith(screens: PhoneSnapshot[], effect: PhoneTapAssessment['effect'] = 'write') {
  let at = 0;
  const taps: string[] = [];
  const phone = {
    execute: async (_: string, operation: string, args: { ref?: string }) => {
      if (operation === 'tap') { taps.push(args.ref!); at++; return { ok: true, screen: screens[at] }; }
      // Like the native wait: the old screen comes back, and only the next observe reads the new one.
      if (operation === 'wait') { const before = screens[at]; at = Math.min(at + 1, screens.length - 1); return before; }
      return screens[at];
    },
    assessTap: async () => ({ effect, target: { label: 'x' } }),
  } as unknown as PhoneService;
  return { phone, taps };
}

test('a label matches the same text first, then a button whose text starts with it', () => {
  const s = screen(1, element('@a', '去结算(2) ¥18.5'), element('@b', '去结算', false), element('@c', '购物车'));
  expect(findLabel(s, '去结算')?.ref).toBe('@b');
  expect(findLabel(s, ' 购物 车')?.ref).toBe('@c');
  expect(findLabel(screen(2, element('@a', '去结算(2)')), '去结算')?.ref).toBe('@a');
  expect(findLabel(s, '去支付')).toBeUndefined();
});

test('the way back is tapped step by step, waiting for a page that is still loading', async () => {
  const order = screen(4, element('@pay', '去支付'));
  const { phone, taps } = phoneWith([screen(1, element('@cart', '购物车')), screen(2), screen(3, element('@go', '去结算')), order]);
  expect(await replayRestore(phone, sessionId, ['购物车', '去结算'])).toEqual(order);
  expect(taps).toEqual(['@cart', '@go']);
});

test('a missing step or a payment button stops the replay for the agent to take over', async () => {
  expect(await replayRestore(phoneWith([screen(1, element('@x', '首页'))]).phone, sessionId, ['购物车'], undefined, 50)).toBeNull();
  const money = phoneWith([screen(1, element('@pay', '去支付'))], 'money');
  expect(await replayRestore(money.phone, sessionId, ['去支付'])).toBeNull();
  expect(money.taps).toEqual([]);
});

test('a whole route replays from the step the reloaded page shows, and a later step on screen skips ahead', async () => {
  const order = screen(3, element('@pay', 'Pay now'));
  const route = ['Order drinks', 'Milk tea', 'Add to cart', 'Cart', 'Go to checkout'];
  const reloaded = phoneWith([screen(1, element('@home', 'Tea Shop home'), element('@cart', 'Cart')), screen(2, element('@go', 'Go to checkout')), order]);
  expect(await replayRestore(reloaded.phone, sessionId, route)).toEqual(order);
  expect(reloaded.taps).toEqual(['@cart', '@go']);
  const bar = phoneWith([screen(1, element('@cart', '购物车'), element('@go', '去结算')), order]);
  expect(await replayRestore(bar.phone, sessionId, ['购物车', '去结算'])).toEqual(order);
  expect(bar.taps).toEqual(['@go']);
});

test('the way back never adds to the cart again, and opens the cart when no step is on screen', async () => {
  const order = screen(3, element('@pay', 'Pay now'));
  // MiniHost: the route went Order drinks → Milk tea → Add to cart → Go to checkout; the reloaded home only shows Cart.
  const route = ['Order drinks', 'Milk tea', 'Add to cart', 'Go to checkout'];
  const reloaded = phoneWith([screen(1, element('@home', 'Tea Shop home (reloaded)'), element('@cart', 'Cart')), screen(2, element('@go', 'Go to checkout')), order]);
  expect(await replayRestore(reloaded.phone, sessionId, route)).toEqual(order);
  expect(reloaded.taps).toEqual(['@cart', '@go']);
  const menu = phoneWith([screen(1, element('@add', '加入购物车'), element('@x', '首页'))]);
  expect(await replayRestore(menu.phone, sessionId, ['奶茶', '加入购物车', '去结算'], undefined, 50)).toBeNull();
  expect(menu.taps).toEqual([]);
});
