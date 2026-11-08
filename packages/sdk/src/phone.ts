/** Copilot's native phone capability. Setup and session scope are chosen by the user. */
export type PhoneReadiness = {
  supported: boolean;
  accessibility: boolean;
  helper: boolean;
  helperStatus: string;
  helperFailure?: string | null;
  locked: boolean;
  sessionId: string | null;
  packages: string[];
  handedOver: boolean;
  paused?: boolean;
};

export type PhoneApp = { packageName: string; label: string; iconUri?: string | null; launchable?: boolean };
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
/** Ephemeral, local UI image. Do not persist or return from a model-facing tool. */
export type PhonePreview = { uri: string; width: number; height: number };
export type PhoneOperation = 'observe' | 'launch' | 'tap' | 'submit' | 'setProgress' | 'type' | 'scroll' | 'back' | 'wait';
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

export interface PhoneService {
  readiness(signal?: AbortSignal): Promise<PhoneReadiness>;
  setup(kind: 'accessibility' | 'wireless'): Promise<void>;
  pair(code: string, port: number): Promise<PhoneReadiness>;
  connect(port?: number): Promise<PhoneReadiness>;
  disconnect(): Promise<void>;
  apps(): Promise<PhoneApp[]>;
  begin(packages: string[], signal?: AbortSignal): Promise<{ sessionId: string; packages: string[] }>;
  readBrightness(sessionId: string, signal?: AbortSignal): Promise<PhoneBrightness>;
  setBrightness(sessionId: string, percent: number, adaptive?: boolean, signal?: AbortSignal): Promise<PhoneBrightnessChange>;
  preview(sessionId: string): Promise<PhonePreview | null>;
  assessSubmit(sessionId: string, snapshotId: string, ref: string): Promise<PhoneTapAssessment>;
  assessTap(sessionId: string, snapshotId: string, ref: string): Promise<PhoneTapAssessment>;
  execute(sessionId: string, operation: PhoneOperation, args: Record<string, unknown>, signal?: AbortSignal): Promise<PhoneResult>;
  end(sessionId: string, signal?: AbortSignal): Promise<void>;
  takeover(sessionId: string, signal?: AbortSignal): Promise<void>;
  handback(sessionId: string): Promise<void>;
}
