import type { KV, PhoneService } from '@pku-harness/sdk';
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
    const state = await phone.readiness(signal);
    if (state.sessionId) return { sessionId: state.sessionId, packages: state.packages };
    return phone.begin(preferences.packages, signal);
  });
}
