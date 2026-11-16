import type { PhoneElement, PhoneResult, PhoneService, PhoneSnapshot } from '@pku-harness/sdk';

/** How long one step waits for its button to show up (a mini program page loading). */
const STEP_WAIT_MS = 8000;

const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();
const snapshotOf = (result: PhoneResult): PhoneSnapshot => ('screen' in result ? result.screen : result);

/** The button named [label]: same text, else text that starts with it (「去结算(2)」 for 「去结算」). Clickable first. */
export function findLabel(screen: PhoneSnapshot, label: string): PhoneElement | undefined {
  const want = normalize(label);
  if (!want) return undefined;
  const exact = screen.elements.filter((e) => normalize(e.text) === want);
  const prefixed = screen.elements.filter((e) => normalize(e.text).startsWith(want));
  for (const group of [exact, prefixed]) {
    const hit = group.find((e) => e.clickable) ?? group[0];
    if (hit) return hit;
  }
  return undefined;
}

/** Buttons that change the order (another drink in the cart): never tapped again on the way back. */
const CHANGES_ORDER = /加入购物车|加购|加入购物袋|再来一[份单杯]|^[+＋]$|add to (cart|bag)/i;
/** The cart keeps the order through a reload: the way back starts there when no step is on screen. */
const CART = ['购物车', '购物袋', 'Cart'];

/** The furthest of [labels] from [from] on that is on the screen: a later step can show up first (a cart bar with 去结算 on the home page). */
function furthest(screen: PhoneSnapshot, labels: string[], from: number): { index: number; element: PhoneElement } | undefined {
  for (let index = labels.length - 1; index >= from; index--) {
    const element = findLabel(screen, labels[index]!);
    if (element) return { index, element };
  }
  return undefined;
}

/**
 * Taps the [route] back on the reloaded app, without the model: each tap is the furthest label on the
 * screen, so a whole route (from before the cart) and a short way back both work. Each step waits
 * for a page that is still loading, and only ordinary taps go (a payment or submit button stops it).
 * Returns the last screen once the last label was tapped, or null when a step could not be, so the
 * agent finds its own way back.
 */
export async function replayRestore(phone: PhoneService, sessionId: string, route: string[], signal?: AbortSignal, stepWaitMs = STEP_WAIT_MS): Promise<PhoneSnapshot | null> {
  const steps = route.filter((label) => !CHANGES_ORDER.test(label.trim()));
  if (!steps.length) return null;
  let cartTried = false;
  let screen = snapshotOf(await phone.execute(sessionId, 'observe', {}, signal));
  for (let next = 0; next < steps.length;) {
    const deadline = Date.now() + stepWaitMs;
    const find = () => {
      const step = furthest(screen, steps, next);
      if (step || cartTried) return step;
      // Opening the cart doesn't advance the route (index next - 1).
      const cart = furthest(screen, CART, 0);
      return cart && { index: next - 1, element: cart.element };
    };
    let hit = find();
    while (!hit) {
      if (Date.now() >= deadline) return null;
      // wait returns the screen it last had when nothing changed, and a tap's screen can predate
      // the page updating in place: read afresh after it.
      await phone.execute(sessionId, 'wait', { timeoutMs: 700 }, signal);
      screen = snapshotOf(await phone.execute(sessionId, 'observe', {}, signal));
      hit = find();
    }
    if (hit.index < next) cartTried = true;
    const assessment = await phone.assessTap(sessionId, screen.snapshotId, hit.element.ref);
    if (assessment.effect !== 'write') return null;
    const result = await phone.execute(sessionId, 'tap', { snapshotId: screen.snapshotId, ref: hit.element.ref, authorizedEffect: 'write' }, signal);
    if ('ok' in result && !result.ok) return null;
    screen = snapshotOf(result);
    next = hit.index + 1;
  }
  return screen;
}
