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
};

export type PhoneApp = { packageName: string; label: string };
export type PhoneTapAssessment = { effect: 'write' | 'public' | 'money'; target: { label: string; context?: string } };
/** Ephemeral, local UI image. Do not persist or return from a model-facing tool. */
export type PhonePreview = { uri: string; width: number; height: number };
export type PhoneOperation = 'observe' | 'launch' | 'tap' | 'type' | 'scroll' | 'back' | 'wait';
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
  readiness(): Promise<PhoneReadiness>;
  setup(kind: 'accessibility' | 'wireless'): Promise<void>;
  pair(code: string, port: number): Promise<PhoneReadiness>;
  connect(port?: number): Promise<PhoneReadiness>;
  disconnect(): Promise<void>;
  apps(): Promise<PhoneApp[]>;
  begin(packages: string[]): Promise<{ sessionId: string; packages: string[] }>;
  preview(sessionId: string): Promise<PhonePreview | null>;
  assessTap(sessionId: string, snapshotId: string, ref: string): Promise<PhoneTapAssessment>;
  execute(sessionId: string, operation: PhoneOperation, args: Record<string, unknown>, signal?: AbortSignal): Promise<PhoneResult>;
  end(sessionId: string, signal?: AbortSignal): Promise<void>;
  takeover(sessionId: string, signal?: AbortSignal): Promise<void>;
  handback(sessionId: string): Promise<void>;
}
