import type { NotifyPermission, PhoneReadiness } from '@pku-harness/sdk';

/**
 * What Copilot needs before it can take a task, in the order the setup screen walks through it.
 * - notifications: carries the pairing-code box during setup and the Stop action during tasks.
 *   Recommended, never blocking (the code can also be typed on the setup screen).
 * - helper: the on-device helper started through Wireless debugging (virtual display, input).
 * - accessibility: Copilot's accessibility service (reads screens, floating controls). Turned on
 *   by the helper itself once it connects.
 * - apps: at least one allowed app, all still installed.
 * - enable: the user's switch for future tasks.
 */
export type SetupStepId = 'helper' | 'accessibility' | 'notifications' | 'apps' | 'enable';

/** done; todo = not done yet; working = in progress (helper connecting, accessibility turning on); attention = failed or broken. */
export type SetupStepState = 'done' | 'todo' | 'working' | 'attention';

export type SetupStep = { id: SetupStepId; state: SetupStepState; required: boolean };

export type SetupInput = {
  readiness: PhoneReadiness;
  enabled: boolean;
  configuredPackages: readonly string[];
  /** Saved packages that are no longer installed (unknown until the app list loads: pass 0). */
  missingPackages: number;
  /** null while unknown. */
  notifications: NotifyPermission | null;
};

export type CopilotSetup = {
  /** unsupported: this Android can't run Copilot; setup: something required is missing; ready: tasks can start. */
  phase: 'unsupported' | 'setup' | 'ready';
  steps: SetupStep[];
  /** The first required step that isn't done: the one the screen expands and points at. */
  current: SetupStepId | null;
  /** Required steps that are done, out of `required`. */
  done: number;
  required: number;
};

const ORDER: readonly SetupStepId[] = ['notifications', 'helper', 'accessibility', 'apps', 'enable'];

function stateOf(id: SetupStepId, input: SetupInput): SetupStepState {
  const { readiness: r } = input;
  switch (id) {
    case 'helper':
      if (r.helper) return 'done';
      if (r.helperStatus === 'connecting') return 'working';
      return r.helperStatus === 'failed' ? 'attention' : 'todo';
    case 'accessibility':
      if (r.accessibility) return 'done';
      return r.accessibilityAuto ? 'working' : 'todo';
    case 'notifications':
      return input.notifications === 'granted' ? 'done' : 'todo';
    case 'apps':
      if (input.missingPackages > 0) return 'attention';
      return input.configuredPackages.length > 0 ? 'done' : 'todo';
    case 'enable':
      return input.enabled ? 'done' : 'todo';
  }
}

/** Derive every setup step and the overall phase from live readiness and saved preferences. */
export function deriveSetup(input: SetupInput): CopilotSetup {
  const steps = ORDER.map((id) => ({ id, state: stateOf(id, input), required: id !== 'notifications' }));
  const required = steps.filter((s) => s.required);
  const done = required.filter((s) => s.state === 'done').length;
  const current = required.find((s) => s.state !== 'done')?.id ?? null;
  const phase = !input.readiness.supported ? 'unsupported' : current ? 'setup' : 'ready';
  return { phase, steps, current, done, required: required.length };
}

/** Everything the Enable step depends on is done, so the switch may be turned on. */
export function canEnable(setup: CopilotSetup): boolean {
  return setup.phase !== 'unsupported' && setup.steps.every((s) => !s.required || s.id === 'enable' || s.state === 'done');
}

/** Required steps still missing, for the agent's status tool (no notification: it never blocks). */
export function missingSteps(setup: CopilotSetup): SetupStepId[] {
  return setup.steps.filter((s) => s.required && s.state !== 'done').map((s) => s.id);
}

/** The setup screen moved into ready while the user watched: the moment to confirm "you're set". */
export function becameReady(previous: CopilotSetup['phase'] | null, next: CopilotSetup['phase']): boolean {
  return previous === 'setup' && next === 'ready';
}

/** Which helper form to open first: pairing for a phone that never paired, reconnect otherwise. */
export function connectionMode(readiness: Pick<PhoneReadiness, 'helperStatus' | 'helperFailure'>): 'pair' | 'reconnect' {
  if (readiness.helperStatus === 'not-paired') return 'pair';
  return readiness.helperFailure === 'AuthorizationRevoked' || readiness.helperFailure === 'KeyUnreadable' ? 'pair' : 'reconnect';
}

/**
 * Where a pairing that is being followed stands, for the line under the helper button: still
 * looking for Settings' pairing dialog, or found it (the code box in the notification is live).
 */
export function pairingProgress(r: Pick<PhoneReadiness, 'helper' | 'helperStatus' | 'pairingActive' | 'pairing'>): 'waitingForDialog' | 'dialogFound' | null {
  if (r.helper || !r.pairingActive || r.helperStatus === 'connecting') return null;
  return r.pairing === 'found' ? 'dialogFound' : 'waitingForDialog';
}

/** The system steps the user takes in Settings; turning on Developer options first only when they're off. */
export function wirelessSteps(r: Pick<PhoneReadiness, 'developerOptions'>): ('developerOptions' | 'wireless' | 'pairDialog' | 'enterCode')[] {
  const steps = ['wireless', 'pairDialog', 'enterCode'] as const;
  return r.developerOptions === false ? ['developerOptions', ...steps] : [...steps];
}

export type HelperHint = 'pairingExpired' | 'wifiNeeded' | 'pairAgain' | 'usbStopped' | 'retryConnection';

/** Recovery copy for a failed helper connection; null when there is no failure to explain. */
export function helperHint(failure: string | null | undefined): HelperHint | null {
  if (!failure) return null;
  if (failure === 'WrongCode' || failure === 'PairingWindowClosed') return 'pairingExpired';
  if (failure === 'NoWifi' || failure === 'WifiNotAllowed') return 'wifiNeeded';
  if (failure === 'AuthorizationRevoked' || failure === 'KeyUnreadable') return 'pairAgain';
  if (failure === 'UsbHelperStopped') return 'usbStopped';
  return 'retryConnection';
}

/**
 * The port from what the user copied out of Android's pairing or Wireless debugging screen: a bare
 * port, or "IP address & Port" as shown there (192.168.1.5:37145, [fe80::1]:37145). The helper
 * always connects to this phone itself, so only the port matters. null when there is no valid port.
 */
export function parsePort(input: string): number | null {
  const m = /^(?:.*:)?(\d{1,5})$/.exec(input.trim().replace(/\s+/g, ''));
  const port = m ? Number(m[1]) : NaN;
  return port >= 1 && port <= 65535 ? port : null;
}
