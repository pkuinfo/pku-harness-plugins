import { expect, test } from 'bun:test';
import type { KV, PhoneService, PhoneReadiness } from '@pku-harness/sdk';
import { configureCopilot, loadCopilotPreferences, saveCopilotPreferences, startCopilot } from './preferences';

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
  await expect(startCopilot(f.kv, f.phone)).rejects.toThrow('Enable Copilot');
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
  await expect(startCopilot(f.kv, f.phone)).rejects.toThrow('Enable Copilot');
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
  await expect(later).rejects.toThrow('Enable Copilot');
  expect(f.ended).toEqual(['late']);
});

test('Disable revokes saved authorization even when a selected app was uninstalled', async () => {
  const f = fixture();
  await saveCopilotPreferences(f.kv, { enabled: true, packages: ['org.example.removed'] });
  await configureCopilot(f.kv, f.phone, { enabled: false, packages: ['org.example.removed'] });
  expect((await loadCopilotPreferences(f.kv)).enabled).toBe(false);
  await expect(startCopilot(f.kv, f.phone)).rejects.toThrow('Enable Copilot');
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
