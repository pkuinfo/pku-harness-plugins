import { afterEach, beforeEach, describe } from 'bun:test';

import { at, clockZone, setClockZone, type ClockZone } from './clock';

/**
 * Test helpers for wall-clock code: run a suite once per clock zone so every layer is checked
 * under the device zone and under fixed zones on both sides of UTC. Test-only (imports
 * `bun:test`); not exported from the SDK index — import `@pku-harness/sdk/testing`.
 */

export const SHANGHAI = { id: 'Asia/Shanghai', offsetMinutes: 480 } satisfies ClockZone;
/** A fixed UTC-8 (Los Angeles standard time, no DST). */
export const MINUS_8 = { id: 'Etc/GMT+8', offsetMinutes: -480 } satisfies ClockZone;
export const KATHMANDU = { id: 'Asia/Kathmandu', offsetMinutes: 345 } satisfies ClockZone;

/** The zones `eachZone` runs a suite in. */
export const TEST_ZONES: [label: string, zone: ClockZone][] = [
  ['device', 'device'],
  ['+08:00', SHANGHAI],
  ['-08:00', MINUS_8],
];

/** Run `fn` with the clock in `zone`, then put the previous zone back. */
export function withZone<T>(zone: ClockZone, fn: () => T): T {
  const prev = clockZone();
  setClockZone(zone);
  try {
    return fn();
  } finally {
    setClockZone(prev);
  }
}

/** `clock.at` pinned to one zone, for building fixtures outside the tests themselves. */
export const atIn =
  (zone: ClockZone) =>
  (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number =>
    withZone(zone, () => at(year, month, day, hour, minute, second));

/**
 * Define the suite once per zone in `zones` (default {@link TEST_ZONES}). Each test runs with
 * the clock set to that zone and is reset to 'device' afterwards. Describe bodies are collected
 * before the zone is set, so build fixtures with the `at` passed in (or call clock functions
 * inside tests only).
 */
export function eachZone(fn: (at: ReturnType<typeof atIn>, zone: ClockZone) => void, zones = TEST_ZONES): void {
  for (const [label, zone] of zones) {
    describe(`[${label}]`, () => {
      beforeEach(() => setClockZone(zone));
      afterEach(() => setClockZone('device'));
      fn(atIn(zone), zone);
    });
  }
}
