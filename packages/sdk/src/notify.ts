/**
 * What on-time delivery of reminders and scheduled checks needs from the OS (Android first):
 * the notification permission, the "Alarms & reminders" special access (exact alarms; Android
 * 14+ denies it by default), and, advisory, no battery optimisation for the app.
 */

export type NotifyPermission = 'granted' | 'undetermined' | 'denied';

export interface NotifyReadiness {
  /** 'denied' = the system won't ask again; only system settings can turn it on. */
  notifications: NotifyPermission;
  /** Exact alarms allowed (always true where the OS has no such permission). */
  exactAlarms: boolean;
  /** The OS may defer the app's background work (battery optimisation on). */
  batteryOptimized: boolean;
}

/** Something the user can fix: shows the system prompt or opens the matching system screen. */
export type NotifyFixKind = 'notifications' | 'exactAlarms' | 'battery';

/**
 * The first thing that stops reminders from arriving on the minute, or null when nothing
 * does. Battery optimisation is advisory (exact alarms still fire), so it never blocks.
 */
export function deliveryBlocker(r: NotifyReadiness): 'notifications' | 'exactAlarms' | null {
  if (r.notifications !== 'granted') return 'notifications';
  if (!r.exactAlarms) return 'exactAlarms';
  return null;
}
