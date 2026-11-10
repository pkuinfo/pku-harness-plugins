import { describe, expect, test } from 'bun:test';
import type { PhoneReadiness } from '@pku-harness/sdk';
import { becameReady, canEnable, connectionMode, deriveSetup, helperHint, missingSteps, type SetupInput } from './setup';

const readiness: PhoneReadiness = { supported: true, accessibility: false, helper: false, helperStatus: 'not-paired', locked: false, sessionId: null, packages: [], handedOver: false };
const fresh: SetupInput = { readiness, enabled: false, configuredPackages: [], missingPackages: 0, notifications: 'undetermined' };
const ready: SetupInput = { readiness: { ...readiness, accessibility: true, helper: true, helperStatus: 'running' }, enabled: true, configuredPackages: ['org.example.notes'], missingPackages: 0, notifications: 'granted' };
const states = (input: SetupInput) => Object.fromEntries(deriveSetup(input).steps.map((s) => [s.id, s.state]));

describe('deriveSetup', () => {
  test('a fresh install starts at the helper with nothing done', () => {
    const setup = deriveSetup(fresh);
    expect(setup.phase).toBe('setup');
    expect(setup.current).toBe('helper');
    expect(setup.steps.map((s) => s.id)).toEqual(['helper', 'accessibility', 'notifications', 'apps', 'enable']);
    expect(setup).toMatchObject({ done: 0, required: 4 });
  });

  test('everything granted and enabled is ready', () => {
    expect(deriveSetup(ready)).toMatchObject({ phase: 'ready', current: null, done: 4, required: 4 });
  });

  test('notifications are recommended, never blocking', () => {
    const setup = deriveSetup({ ...ready, notifications: 'denied' });
    expect(setup.phase).toBe('ready');
    expect(states({ ...ready, notifications: 'denied' }).notifications).toBe('todo');
    expect(states({ ...ready, notifications: null }).notifications).toBe('todo');
    expect(missingSteps(setup)).toEqual([]);
  });

  test('the current step is the first required one left, in order', () => {
    const helperOnly = { ...fresh, readiness: { ...readiness, helper: true, helperStatus: 'running' } };
    expect(deriveSetup(helperOnly).current).toBe('accessibility');
    // Accessibility can be turned on before the helper (Settings route); the helper stays current.
    expect(deriveSetup({ ...fresh, readiness: { ...readiness, accessibility: true } }).current).toBe('helper');
    expect(deriveSetup({ ...ready, enabled: false }).current).toBe('enable');
    expect(deriveSetup({ ...ready, configuredPackages: [] }).current).toBe('apps');
  });

  test('helper connection progress and failure are distinct states', () => {
    expect(states({ ...fresh, readiness: { ...readiness, helperStatus: 'connecting' } }).helper).toBe('working');
    expect(states({ ...fresh, readiness: { ...readiness, helperStatus: 'failed', helperFailure: 'WrongCode' } }).helper).toBe('attention');
    expect(states({ ...fresh, readiness: { ...readiness, helperStatus: 'wireless-off' } }).helper).toBe('todo');
  });

  test('uninstalled saved apps need attention and block readiness', () => {
    const setup = deriveSetup({ ...ready, missingPackages: 2 });
    expect(setup.phase).toBe('setup');
    expect(setup.current).toBe('apps');
    expect(states({ ...ready, missingPackages: 2 }).apps).toBe('attention');
  });

  test('losing a permission after setup returns to setup at that step', () => {
    const setup = deriveSetup({ ...ready, readiness: { ...ready.readiness, accessibility: false } });
    expect(setup).toMatchObject({ phase: 'setup', current: 'accessibility', done: 3 });
    expect(missingSteps(setup)).toEqual(['accessibility']);
  });

  test('unsupported Android wins over everything', () => {
    expect(deriveSetup({ ...ready, readiness: { ...ready.readiness, supported: false } }).phase).toBe('unsupported');
  });
});

describe('canEnable', () => {
  test('needs helper, accessibility and apps, not notifications or the switch itself', () => {
    expect(canEnable(deriveSetup(fresh))).toBe(false);
    expect(canEnable(deriveSetup({ ...ready, enabled: false, notifications: 'denied' }))).toBe(true);
    expect(canEnable(deriveSetup({ ...ready, enabled: false, configuredPackages: [] }))).toBe(false);
    expect(canEnable(deriveSetup({ ...ready, enabled: false, missingPackages: 1 }))).toBe(false);
    expect(canEnable(deriveSetup({ ...ready, enabled: false, readiness: { ...ready.readiness, supported: false } }))).toBe(false);
  });
});

test('becameReady fires only on a setup → ready transition', () => {
  expect(becameReady('setup', 'ready')).toBe(true);
  expect(becameReady(null, 'ready')).toBe(false);
  expect(becameReady('ready', 'ready')).toBe(false);
  expect(becameReady('ready', 'setup')).toBe(false);
});

test('connectionMode pairs a never-paired or revoked phone, reconnects otherwise', () => {
  expect(connectionMode({ helperStatus: 'not-paired' })).toBe('pair');
  expect(connectionMode({ helperStatus: 'failed', helperFailure: 'AuthorizationRevoked' })).toBe('pair');
  expect(connectionMode({ helperStatus: 'wireless-off' })).toBe('reconnect');
  expect(connectionMode({ helperStatus: 'failed', helperFailure: 'NoWifi' })).toBe('reconnect');
});

test('helperHint maps native failures to recovery copy', () => {
  expect(helperHint(null)).toBeNull();
  expect(helperHint('WrongCode')).toBe('pairingExpired');
  expect(helperHint('PairingWindowClosed')).toBe('pairingExpired');
  expect(helperHint('WifiNotAllowed')).toBe('wifiNeeded');
  expect(helperHint('KeyUnreadable')).toBe('pairAgain');
  expect(helperHint('UsbHelperStopped')).toBe('usbStopped');
  expect(helperHint('SomethingNew')).toBe('retryConnection');
});

test('fill replaces known placeholders and keeps unknown ones', async () => {
  const { fill } = await import('./strings');
  expect(fill('{done} of {total} done', { done: 2, total: 4 })).toBe('2 of 4 done');
  expect(fill('{n} allowed {x}', { n: 3 })).toBe('3 allowed {x}');
});
