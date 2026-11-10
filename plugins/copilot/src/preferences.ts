import type { KV, PhoneReadiness, PhoneService } from '@pku-harness/sdk';
import { z } from 'zod';

const packageName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/);
export const copilotPreferencesSchema = z.object({
  enabled: z.boolean(),
  packages: z.array(packageName).max(20).transform((items) => [...new Set(items)]),
}).refine((value) => !value.enabled || value.packages.length > 0, 'Select at least one app before enabling Copilot.');

export type CopilotPreferences = z.infer<typeof copilotPreferencesSchema>;
const KEY = 'control-preferences';
// Configure and start must not race: disabling while creation is in flight closes that
// session before completing, and no queued start can use the earlier authorization.
let changes = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = changes.then(work);
  changes = result.then(() => {}, () => {});
  return result;
}

/** Saved scope is user-owned; malformed or absent storage never grants access. */
export async function loadCopilotPreferences(kv: KV): Promise<CopilotPreferences> {
  const stored = copilotPreferencesSchema.safeParse(await kv.get(KEY));
  return stored.success ? stored.data : { enabled: false, packages: [] };
}

export async function saveCopilotPreferences(kv: KV, value: CopilotPreferences): Promise<void> {
  await kv.set(KEY, copilotPreferencesSchema.parse(value));
}


export function configureCopilot(kv: KV, phone: PhoneService, input: CopilotPreferences) {
  return serialize(async () => {
    const preferences = copilotPreferencesSchema.parse(input);
    if (preferences.enabled) {
      const installed = new Set((await phone.apps()).map((app) => app.packageName));
      if (preferences.packages.some((name) => !installed.has(name))) throw new Error('Choose installed apps from the Copilot list.');
    }
    // Disabling is always available, even if a saved app was uninstalled or the
    // platform disconnected. Revoke before querying native state.
    if (!preferences.enabled) await saveCopilotPreferences(kv, preferences);
    const state = await phone.readiness();
    const scopeChanged = [...state.packages].sort().join() !== [...preferences.packages].sort().join();
    if (state.sessionId && (!preferences.enabled || scopeChanged)) await phone.end(state.sessionId);
    if (preferences.enabled) await saveCopilotPreferences(kv, preferences);
    return { enabled: preferences.enabled, configuredPackages: preferences.packages };
  });
}

export function startCopilot(kv: KV, phone: PhoneService, signal?: AbortSignal) {
  return serialize(async () => {
    const preferences = await loadCopilotPreferences(kv);
    if (!preferences.enabled || !preferences.packages.length) throw new Error('Enable Copilot and select apps in /copilot first.');
    signal?.throwIfAborted();
    let state = await phone.readiness(signal);
    if (state.sessionId) return { sessionId: state.sessionId, packages: state.packages };
    // If the helper can't restore it, the missing step is reported below as before.
    if (state.helper && !state.accessibility) state = await restoreAccessibility(phone, signal).catch((e) => {
      if (signal?.aborted) throw e;
      return state;
    });
    const missing = [!state.helper && 'phone helper', !state.accessibility && 'accessibility'].filter(Boolean);
    if (missing.length) throw new Error(`Copilot setup is not finished (missing: ${missing.join(', ')}). Ask the user to open /copilot and complete the highlighted step.`);
    return phone.begin(preferences.packages, signal);
  });
}

const RESTORE_WAIT_MS = 3000;
const RESTORE_POLL_MS = 250;

/**
 * Copilot is on but Android dropped its accessibility service (it does so when the app is
 * force-stopped). The connected helper turns it back on without Settings; the switch in
 * /copilot, not that side effect, is the user's choice. Waits briefly for the service to bind.
 */
export async function restoreAccessibility(phone: PhoneService, signal?: AbortSignal): Promise<PhoneReadiness> {
  await phone.setup('accessibility');
  const until = Date.now() + RESTORE_WAIT_MS;
  let state = await phone.readiness(signal);
  while (!state.accessibility && Date.now() < until) {
    await new Promise((r) => setTimeout(r, RESTORE_POLL_MS));
    signal?.throwIfAborted();
    state = await phone.readiness(signal);
  }
  return state;
}
