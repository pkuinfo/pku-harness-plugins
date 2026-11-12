import type { KV, PhoneApp, PhoneReadiness, PhoneService } from '@pku-harness/sdk';
import { z } from 'zod';

const packageName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/);
export const copilotPackagesSchema = z.array(packageName).max(20).transform((items) => [...new Set(items)]);
export const copilotPreferencesSchema = z.object({
  enabled: z.boolean(),
  packages: copilotPackagesSchema,
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
    if (!preferences.enabled || !preferences.packages.length) throw new Error('Copilot is off or has no allowed apps. Call requestApp with the app the user\'s request needs; the user can allow it right there.');
    signal?.throwIfAborted();
    const state = await phone.readiness(signal);
    if (state.sessionId) return { sessionId: state.sessionId, packages: state.packages };
    await readyToBegin(phone, state, signal);
    return phone.begin(preferences.packages, signal);
  });
}

/** Helper and accessibility are on (the helper turns accessibility back on if Android dropped it). */
async function readyToBegin(phone: PhoneService, initial: PhoneReadiness, signal?: AbortSignal) {
  let state = initial;
  // If the helper can't restore it, the missing step is reported below as before.
  if (state.helper && !state.accessibility) state = await restoreAccessibility(phone, signal).catch((e) => {
    if (signal?.aborted) throw e;
    return state;
  });
  const missing = [!state.helper && 'phone helper', !state.accessibility && 'accessibility'].filter(Boolean);
  if (missing.length) throw new Error(`Copilot setup is not finished (missing: ${missing.join(', ')}). Ask the user to open /copilot and complete the highlighted step.`);
}

const MAX_APPS = 20;
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The one installed app the agent named: an exact package name, or an exact (case-insensitive)
 * label. Never a fuzzy pick: a near miss lists only the apps whose name contains the query, so
 * the agent can retry with the right package rather than get a different app approved.
 */
export function resolveCopilotApp(apps: PhoneApp[], query: string): PhoneApp {
  const wanted = normalize(query);
  const byPackage = apps.find((app) => app.packageName === query.trim());
  if (byPackage) return byPackage;
  const named = apps.filter((app) => normalize(app.label) === wanted);
  if (named.length === 1) return named[0]!;
  const list = (items: PhoneApp[]) => items.slice(0, 8).map((app) => `${app.label} (${app.packageName})`).join(', ');
  if (named.length > 1) throw new Error(`Several installed apps are named "${query}": ${list(named)}. Call requestApp again with the package name.`);
  const close = wanted ? apps.filter((app) => normalize(app.label).includes(wanted) || normalize(app.sortKey ?? '').replace(/ /g, '').includes(wanted.replace(/ /g, '')) || app.packageName.toLowerCase().includes(wanted)) : [];
  throw new Error(close.length
    ? `No installed app is exactly "${query}". Similar: ${list(close)}. Call requestApp again with the package name of the one the user means.`
    : `No installed app matches "${query}". If you know its Android package name (for example com.tencent.mm for WeChat), call requestApp with it; otherwise tell the user the app was not found.`);
}

/**
 * Checks before the user is asked to grant an app: the app is installed and not already in scope,
 * and Copilot's setup is complete (otherwise the prompt would grant nothing usable).
 */
export async function assessCopilotApp(phone: PhoneService, query: string, sessionId?: string) {
  const state = await phone.readiness();
  if (!state.supported) throw new Error('Copilot needs an Android build with phone control.');
  if (!state.helper) throw new Error('Copilot setup is not finished (missing: phone helper). Ask the user to open /copilot and complete the highlighted step.');
  const app = resolveCopilotApp(await phone.apps(), query);
  if (state.sessionId && state.packages.includes(app.packageName)) {
    throw new Error(`${app.label} (${app.packageName}) is already allowed in session ${state.sessionId}. Launch it; no permission is needed.`);
  }
  if (sessionId && state.sessionId && sessionId !== state.sessionId) throw new Error('That phone session has ended. Call status for the current one.');
  return app;
}

/**
 * Apply a grant the user just tapped: add the app to the running session (or open one with the
 * saved apps plus this app), and with 'always' save it to the allowed apps and turn Copilot on.
 * 'once' leaves the saved apps unchanged. Callers must have the user's answer; never the agent's.
 */
export function grantCopilotApp(kv: KV, phone: PhoneService, input: { app: string; sessionId?: string; remember: boolean }, signal?: AbortSignal) {
  return serialize(async () => {
    signal?.throwIfAborted();
    const app = resolveCopilotApp(await phone.apps(), input.app);
    const preferences = await loadCopilotPreferences(kv);
    const saved = [...new Set([...preferences.packages, app.packageName])];
    const state = await phone.readiness(signal);
    if (input.sessionId && state.sessionId && input.sessionId !== state.sessionId) throw new Error('That phone session has ended. Call status for the current one.');
    let session: { sessionId: string; packages: string[] };
    if (state.sessionId) {
      session = state.packages.includes(app.packageName) ? { sessionId: state.sessionId, packages: state.packages } : await phone.allow(state.sessionId, app.packageName, signal);
    } else {
      await readyToBegin(phone, state, signal);
      // A switched-off Copilot does not bring back its earlier apps: this task gets only the one granted.
      const others = preferences.enabled ? preferences.packages.filter((name) => name !== app.packageName).slice(0, MAX_APPS - 1) : [];
      session = await phone.begin([...others, app.packageName], signal);
    }
    let note: string | undefined;
    let remembered = false;
    if (input.remember) {
      if (saved.length > MAX_APPS) note = `Allowed for this task only: Copilot saves up to ${MAX_APPS} apps. The user can remove one in /copilot.`;
      else if (!preferences.enabled && preferences.packages.length) {
        // The user switched Copilot off with apps saved. Saving this one must not switch the others back on.
        await saveCopilotPreferences(kv, { enabled: false, packages: saved });
        note = 'Saved to the allowed apps, but Copilot stays switched off (the user turned it off in /copilot), so later tasks will ask again.';
      } else {
        await saveCopilotPreferences(kv, { enabled: true, packages: saved });
        remembered = true;
      }
    }
    return {
      allowed: { packageName: app.packageName, label: app.label },
      scope: remembered ? 'saved' as const : 'thisTask' as const,
      ...session,
      ...(note ? { note } : {}),
    };
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

const VISION_KEY = 'vision-preferences';
const visionSchema = z.object({ screenshots: z.boolean() });
export type CopilotVision = z.infer<typeof visionSchema>;

/**
 * "Let the AI see screenshots" (on by default): Copilot's fallback for apps that hide their
 * contents from accessibility (Taobao, WeChat). Only the user changes it. Saving writes an explicit
 * boolean, so a user who turned it off stays off; never set (absent or malformed) reads as on.
 */
export async function loadCopilotVision(kv: KV): Promise<CopilotVision> {
  const stored = visionSchema.safeParse(await kv.get(VISION_KEY));
  return stored.success ? stored.data : { screenshots: true };
}

export async function saveCopilotVision(kv: KV, value: CopilotVision): Promise<CopilotVision> {
  const parsed = visionSchema.parse(value);
  await kv.set(VISION_KEY, parsed);
  return parsed;
}
