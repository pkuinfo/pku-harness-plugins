/** Copilot's native phone capability. Setup and session scope are chosen by the user. */
export type PhoneReadiness = {
  supported: boolean;
  accessibility: boolean;
  helper: boolean;
  helperStatus: string;
  helperFailure?: string | null;
  /** This phone was paired through Wireless debugging (the helper can restart itself). */
  paired?: boolean;
  /** Settings' "Pair device with pairing code" dialog: looked for, found, or not looked for. */
  pairing?: 'idle' | 'searching' | 'found';
  /** A pairing is being followed: the notification with the code box is (or will be) posted. */
  pairingActive?: boolean;
  developerOptions?: boolean;
  wirelessDebugging?: boolean;
  /** The connected helper is turning accessibility on by itself; no tap needed. */
  accessibilityAuto?: boolean;
  locked: boolean;
  /** Android blocks accessibility for this install until the user allows restricted settings in App info. */
  restricted?: boolean;
  /** "Display over other apps" is allowed: Copilot's floating window then shows in Samsung screen recordings. */
  overlays?: boolean;
  sessionId: string | null;
  packages: string[];
  handedOver: boolean;
  paused?: boolean;
};

/** sortKey: the label in lowercase Latin letters (pinyin for Chinese), for sorting and the A–Z index. */
export type PhoneApp = { packageName: string; label: string; sortKey?: string; iconUri?: string | null; launchable?: boolean };
/** Physical main-display brightness; percent follows Android's perceptual slider scale. */
export type PhoneBrightness = {
  displayId: 0;
  percent: number;
  linear: number;
  minimum: number;
  maximum: number;
  adaptive: boolean;
};
/** Readback at dispatch time; adaptive brightness may adjust the level afterward. */
export type PhoneBrightnessChange = {
  before: PhoneBrightness;
  after: PhoneBrightness;
  requestedPercent: number;
  verified: boolean;
};
export type PhoneTapAssessment = { effect: 'write' | 'public' | 'money'; target: { label: string; context?: string } };
/**
 * Ephemeral, local UI image (the floating/in-app preview). Do not persist it or return it from a
 * model-facing tool. The one exception is Copilot's screenshots (`PhoneService.look`, on by
 * default, the user can turn them off): those reach the model only through `withModelImage`, never as tool output.
 */
export type PhonePreview = { uri: string; width: number; height: number };
/**
 * `tapAt` / `typeAt` take `{ snapshotId, x, y }` (+ `text`) in the pixels of the screenshot
 * returned by `look` with that snapshotId, plus `authorizedEffect` from `assessAt`.
 */
export type PhoneOperation = 'observe' | 'launch' | 'tap' | 'submit' | 'setProgress' | 'type' | 'scroll' | 'back' | 'wait' | 'tapAt' | 'typeAt';
export type PhoneElement = {
  ref: string;
  role: string;
  text: string;
  bounds: number[];
  resourceId: string | null;
  clickable: boolean;
  editable: boolean;
  scrollable: boolean;
  secret: boolean;
  range?: { min: number; max: number; current: number } | null;
};
export type PhoneSnapshot = {
  sessionId: string;
  snapshotId: string;
  packageName: string | null;
  width: number;
  height: number;
  protected: boolean;
  changedDuringRead: boolean;
  elements: PhoneElement[];
  handoff: boolean | null;
};
export type PhoneResult = PhoneSnapshot | { ok: boolean; error?: string; hint?: string | null; changed?: boolean | null; screen: PhoneSnapshot };
/**
 * A screenshot of the controlled display for the model (Copilot's vision fallback) and the
 * observation it belongs to. `image.data` is base64; `image.width`/`height` are the coordinate
 * space of `tapAt`/`typeAt` for `screen.snapshotId`. Never taken of a protected screen.
 */
export type PhoneLook = { screen: PhoneSnapshot; image: { data: string; mediaType: string; width: number; height: number } };

export interface PhoneService {
  readiness(signal?: AbortSignal): Promise<PhoneReadiness>;
  setup(kind: 'accessibility' | 'wireless' | 'appInfo' | 'overlays'): Promise<void>;
  /** Pair with the six-digit code; without a port, the pairing dialog found on this phone is used. */
  pair(code: string, port?: number): Promise<PhoneReadiness>;
  /**
   * Look for the pairing dialog and post a notification whose reply box takes the code, so the
   * user never leaves Settings. Ends by itself once the helper connects (or after 10 minutes).
   */
  startPairing(): Promise<PhoneReadiness>;
  stopPairing(): Promise<void>;
  connect(port?: number): Promise<PhoneReadiness>;
  disconnect(): Promise<void>;
  apps(): Promise<PhoneApp[]>;
  begin(packages: string[], signal?: AbortSignal): Promise<{ sessionId: string; packages: string[] }>;
  /**
   * Add one installed app to a running session's scope. Only after the user granted it (a
   * `grant` tool's prompt); the session's other apps and state are kept.
   */
  allow(sessionId: string, packageName: string, signal?: AbortSignal): Promise<{ sessionId: string; packages: string[] }>;
  readBrightness(sessionId: string, signal?: AbortSignal): Promise<PhoneBrightness>;
  setBrightness(sessionId: string, percent: number, adaptive?: boolean, signal?: AbortSignal): Promise<PhoneBrightnessChange>;
  preview(sessionId: string): Promise<PhonePreview | null>;
  assessSubmit(sessionId: string, snapshotId: string, ref: string): Promise<PhoneTapAssessment>;
  assessTap(sessionId: string, snapshotId: string, ref: string): Promise<PhoneTapAssessment>;
  /** Approval target of a point on the screenshot `snapshotId` (screenshot pixels). Refuses money screens. */
  assessAt(sessionId: string, snapshotId: string, x: number, y: number): Promise<PhoneTapAssessment>;
  /**
   * Observe and capture the controlled display for the model. Only call it while the user has
   * screenshots on (the default); refuses protected screens and other apps on the display.
   */
  look(sessionId: string, signal?: AbortSignal): Promise<PhoneLook>;
  execute(sessionId: string, operation: PhoneOperation, args: Record<string, unknown>, signal?: AbortSignal): Promise<PhoneResult>;
  end(sessionId: string, signal?: AbortSignal): Promise<void>;
  takeover(sessionId: string, signal?: AbortSignal): Promise<void>;
  /**
   * takeover that names the step for the user (shown on the floating panel beside a Done
   * button), then waits until they tap Done, the session ends, or `timeoutMs` passes. Lets a task
   * continue by itself after a payment or login. Missing on hosts or APKs that predate it.
   */
  handoffAndWait?(sessionId: string, note: string, timeoutMs: number, signal?: AbortSignal): Promise<{ handedBack: boolean; ended: boolean; timedOut?: boolean }>;
  handback(sessionId: string): Promise<void>;
}
