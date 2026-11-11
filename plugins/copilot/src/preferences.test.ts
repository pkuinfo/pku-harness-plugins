import { expect, test } from 'bun:test';
import type { KV, PhoneService, PhoneReadiness } from '@pku-harness/sdk';
import { assessCopilotApp, configureCopilot, grantCopilotApp, loadCopilotPreferences, loadCopilotVision, resolveCopilotApp, saveCopilotPreferences, saveCopilotVision, startCopilot } from './preferences';

function fixture() {
  const values = new Map<string, unknown>();
  const kv: KV = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  };
  let state: PhoneReadiness = { supported: true, accessibility: true, helper: true, helperStatus: 'running', locked: false, sessionId: null, packages: [], handedOver: false };
  const begun: string[][] = [];
  const ended: string[] = [];
  const phone = {
    apps: async () => [{ packageName: 'org.example.notes', label: 'Notes' }, { packageName: 'org.example.browser', label: 'Browser' }],
    readiness: async () => state,
    begin: async (packages: string[]) => { begun.push(packages); state = { ...state, sessionId: 'new-session', packages }; return { sessionId: 'new-session', packages }; },
    end: async (id: string) => { ended.push(id); state = { ...state, sessionId: null, packages: [] }; },
  } as PhoneService;
  return { kv, phone, begun, ended, values, setState: (next: Partial<PhoneReadiness>) => { state = { ...state, ...next }; } };
}

test('absent or malformed saved scope never enables phone control', async () => {
  const f = fixture();
  expect(await loadCopilotPreferences(f.kv)).toEqual({ enabled: false, packages: [] });
  f.values.set('control-preferences', { enabled: true, packages: ['invalid package'] });
  expect(await loadCopilotPreferences(f.kv)).toEqual({ enabled: false, packages: [] });
  await expect(startCopilot(f.kv, f.phone)).rejects.toThrow('Copilot is off');
  expect(f.begun).toEqual([]);
});

test('automatic start uses only the saved user-selected scope', async () => {
  const f = fixture();
  await configureCopilot(f.kv, f.phone, { enabled: true, packages: ['org.example.notes', 'org.example.notes'] });
  await startCopilot(f.kv, f.phone);
  expect(f.begun).toEqual([['org.example.notes']]);
  await expect(configureCopilot(f.kv, f.phone, { enabled: true, packages: ['org.example.uninstalled'] })).rejects.toThrow('installed apps');
  expect((await loadCopilotPreferences(f.kv)).packages).toEqual(['org.example.notes']);
});

test('changing enabled scope ends an existing differently scoped session', async () => {
  const f = fixture();
  f.setState({ sessionId: 'old', packages: ['org.example.browser'] });
  await configureCopilot(f.kv, f.phone, { enabled: true, packages: ['org.example.notes'] });
  expect(f.ended).toEqual(['old']);
  expect(await loadCopilotPreferences(f.kv)).toEqual({ enabled: true, packages: ['org.example.notes'] });
});

test('disable remains persisted even if native cleanup fails', async () => {
  const f = fixture();
  await saveCopilotPreferences(f.kv, { enabled: true, packages: ['org.example.notes'] });
  f.setState({ sessionId: 'old', packages: ['org.example.notes'] });
  f.phone.end = async () => { throw new Error('cleanup failed'); };
  await expect(configureCopilot(f.kv, f.phone, { enabled: false, packages: ['org.example.notes'] })).rejects.toThrow('cleanup failed');
  expect((await loadCopilotPreferences(f.kv)).enabled).toBe(false);
  await expect(startCopilot(f.kv, f.phone)).rejects.toThrow('Copilot is off');
});

test('cancelled task cannot start and active handoff is reused without opening a new display', async () => {
  const f = fixture();
  await saveCopilotPreferences(f.kv, { enabled: true, packages: ['org.example.notes'] });
  const run = new AbortController(); run.abort();
  await expect(startCopilot(f.kv, f.phone, run.signal)).rejects.toThrow();
  f.setState({ sessionId: 'existing', packages: ['org.example.notes'], handedOver: true });
  expect(await startCopilot(f.kv, f.phone)).toEqual({ sessionId: 'existing', packages: ['org.example.notes'] });
  expect(f.begun).toEqual([]);
});


test('disabling during creation closes the late session and prevents queued automatic starts', async () => {
  const f = fixture();
  await saveCopilotPreferences(f.kv, { enabled: true, packages: ['org.example.notes'] });
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  f.phone.begin = async (packages) => {
    started();
    await new Promise<void>((resolve) => { finish = resolve; });
    f.setState({ sessionId: 'late', packages });
    return { sessionId: 'late', packages };
  };
  const opening = startCopilot(f.kv, f.phone);
  await entered;
  const disabling = configureCopilot(f.kv, f.phone, { enabled: false, packages: ['org.example.notes'] });
  const later = startCopilot(f.kv, f.phone);
  finish();
  await opening;
  await disabling;
  await expect(later).rejects.toThrow('Copilot is off');
  expect(f.ended).toEqual(['late']);
});

test('Disable revokes saved authorization even when a selected app was uninstalled', async () => {
  const f = fixture();
  await saveCopilotPreferences(f.kv, { enabled: true, packages: ['org.example.removed'] });
  await configureCopilot(f.kv, f.phone, { enabled: false, packages: ['org.example.removed'] });
  expect((await loadCopilotPreferences(f.kv)).enabled).toBe(false);
  await expect(startCopilot(f.kv, f.phone)).rejects.toThrow('Copilot is off');
});

test('Disable is persisted before a disconnected native readiness probe can fail', async () => {
  const f = fixture();
  await saveCopilotPreferences(f.kv, { enabled: true, packages: ['org.example.notes'] });
  f.phone.readiness = async () => { throw new Error('native unavailable'); };
  await expect(configureCopilot(f.kv, f.phone, { enabled: false, packages: ['org.example.notes'] })).rejects.toThrow('native unavailable');
  expect((await loadCopilotPreferences(f.kv)).enabled).toBe(false);
});

test('start names the unfinished setup steps instead of opening a session', async () => {
  const f = fixture();
  await configureCopilot(f.kv, f.phone, { enabled: true, packages: ['org.example.notes'] });
  f.setState({ helper: false, accessibility: false });
  await expect(startCopilot(f.kv, f.phone)).rejects.toThrow('missing: phone helper, accessibility');
  f.setState({ helper: true });
  await expect(startCopilot(f.kv, f.phone)).rejects.toThrow('missing: accessibility');
  expect(f.begun).toEqual([]);
});

test('a dropped accessibility service is restored through the helper before a task starts', async () => {
  const f = fixture();
  await saveCopilotPreferences(f.kv, { enabled: true, packages: ['org.example.notes'] });
  f.setState({ accessibility: false });
  const setups: string[] = [];
  f.phone.setup = async (kind) => { setups.push(kind); f.setState({ accessibility: true }); };
  await startCopilot(f.kv, f.phone);
  expect(setups).toEqual(['accessibility']);
  expect(f.begun).toEqual([['org.example.notes']]);
});

test('without the helper a missing accessibility service still stops the task', async () => {
  const f = fixture();
  await saveCopilotPreferences(f.kv, { enabled: true, packages: ['org.example.notes'] });
  f.setState({ accessibility: false, helper: false, helperStatus: 'wireless-off' });
  const setups: string[] = [];
  f.phone.setup = async (kind) => { setups.push(kind); };
  await expect(startCopilot(f.kv, f.phone)).rejects.toThrow('not finished');
  expect(setups).toEqual([]);
});

function grantFixture() {
  const f = fixture();
  const allowed: [string, string][] = [];
  f.phone.allow = async (sessionId, packageName) => {
    allowed.push([sessionId, packageName]);
    const state = await f.phone.readiness();
    f.setState({ packages: [...state.packages, packageName] });
    return { sessionId, packages: [...state.packages, packageName] };
  };
  return { ...f, allowed };
}

test('apps are resolved exactly by package or name, never by a fuzzy pick', () => {
  const apps = [{ packageName: 'com.tencent.mm', label: '微信', sortKey: 'wei xin' }, { packageName: 'org.example.notes', label: 'Notes' }, { packageName: 'org.example.notes2', label: 'Notes' }];
  expect(resolveCopilotApp(apps, 'com.tencent.mm').label).toBe('微信');
  expect(resolveCopilotApp(apps, ' 微信 ').packageName).toBe('com.tencent.mm');
  expect(() => resolveCopilotApp(apps, 'Notes')).toThrow('package name');
  expect(() => resolveCopilotApp(apps, 'weixin')).toThrow('com.tencent.mm');
  expect(() => resolveCopilotApp(apps, 'WeChat')).toThrow('No installed app matches');
});

test('the prompt is refused up front when the app is already in scope or the helper is missing', async () => {
  const f = grantFixture();
  f.setState({ sessionId: 'live', packages: ['org.example.notes'] });
  await expect(assessCopilotApp(f.phone, 'Notes')).rejects.toThrow('already allowed');
  expect((await assessCopilotApp(f.phone, 'Browser')).packageName).toBe('org.example.browser');
  await expect(assessCopilotApp(f.phone, 'Browser', '00000000-0000-4000-8000-000000000000')).rejects.toThrow('ended');
  f.setState({ helper: false });
  await expect(assessCopilotApp(f.phone, 'Browser')).rejects.toThrow('phone helper');
});

test('allow once extends the running session and leaves the saved apps alone', async () => {
  const f = grantFixture();
  await configureCopilot(f.kv, f.phone, { enabled: true, packages: ['org.example.notes'] });
  f.setState({ sessionId: 'live', packages: ['org.example.notes'] });
  const result = await grantCopilotApp(f.kv, f.phone, { app: 'Browser', remember: false });
  expect(f.allowed).toEqual([['live', 'org.example.browser']]);
  expect(result).toMatchObject({ scope: 'thisTask', sessionId: 'live', packages: ['org.example.notes', 'org.example.browser'] });
  expect(f.ended).toEqual([]);
  expect(await loadCopilotPreferences(f.kv)).toEqual({ enabled: true, packages: ['org.example.notes'] });
});

test('always allow saves the app and turns Copilot on when nothing was set up', async () => {
  const f = grantFixture();
  const result = await grantCopilotApp(f.kv, f.phone, { app: 'org.example.browser', remember: true });
  expect(f.begun).toEqual([['org.example.browser']]);
  expect(result).toMatchObject({ scope: 'saved', sessionId: 'new-session' });
  expect(await loadCopilotPreferences(f.kv)).toEqual({ enabled: true, packages: ['org.example.browser'] });
  // The session now matches the saved scope, so a later start reuses it.
  expect(await startCopilot(f.kv, f.phone)).toEqual({ sessionId: 'new-session', packages: ['org.example.browser'] });
});

test('a new session from a grant adds the app to the saved apps when Copilot is on', async () => {
  const f = grantFixture();
  await configureCopilot(f.kv, f.phone, { enabled: true, packages: ['org.example.notes'] });
  await grantCopilotApp(f.kv, f.phone, { app: 'Browser', remember: false });
  expect(f.begun).toEqual([['org.example.notes', 'org.example.browser']]);
});

test('a switched-off Copilot only gets the granted app and is not switched back on', async () => {
  const f = grantFixture();
  await configureCopilot(f.kv, f.phone, { enabled: false, packages: ['org.example.notes'] });
  const result = await grantCopilotApp(f.kv, f.phone, { app: 'Browser', remember: true });
  expect(f.begun).toEqual([['org.example.browser']]);
  expect(result).toMatchObject({ scope: 'thisTask' });
  expect(await loadCopilotPreferences(f.kv)).toEqual({ enabled: false, packages: ['org.example.notes', 'org.example.browser'] });
});

test('a grant still needs finished setup before it opens a session', async () => {
  const f = grantFixture();
  f.setState({ helper: false, accessibility: false });
  await expect(grantCopilotApp(f.kv, f.phone, { app: 'Browser', remember: true })).rejects.toThrow('not finished');
  expect(f.begun).toEqual([]);
  expect(await loadCopilotPreferences(f.kv)).toEqual({ enabled: false, packages: [] });
});

test('screenshots are on when never set and stay off once the user turned them off', async () => {
  const f = fixture();
  expect(await loadCopilotVision(f.kv)).toEqual({ screenshots: true });
  f.values.set('vision-preferences', { screenshots: 'yes' });
  expect(await loadCopilotVision(f.kv)).toEqual({ screenshots: true });
  await saveCopilotVision(f.kv, { screenshots: false });
  expect(await loadCopilotVision(f.kv)).toEqual({ screenshots: false });
  await saveCopilotVision(f.kv, { screenshots: true });
  expect(await loadCopilotVision(f.kv)).toEqual({ screenshots: true });
});
