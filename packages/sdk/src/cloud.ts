import type { z } from 'zod';

/**
 * PKU Harness Cloud, the plugin side (docs/CLOUD.md §2). A plugin declares what it uses in
 * `PluginDef.cloud` and gets a client bound to itself (`ctx.cloud`, `props.cloud`): the host
 * holds the device identity, tokens and keys, enforces the user's consent and the manifest,
 * and talks to whichever provider the user chose (official, self-hosted or any URL). Plugins
 * never see tokens, keys or the provider's credentials, and the agent never sees share links.
 * The wire protocol lives in `@pku-harness/cloud-protocol`.
 */

/** Standard services every conforming provider may offer (`GET /v1/meta` lists them). */
export type CloudService = 'store' | 'channels' | 'push' | 'files' | 'functions';

export interface CloudManifest {
  protocol: 1;
  uses: CloudService[];
  /** Plain-language lines shown in the consent sheet: exactly what leaves the device. */
  disclosure: { zh: string[]; en?: string[] };
  /** All store/channel payloads are client-encrypted; the host refuses plaintext writes when true. */
  e2e: boolean;
  /** Plugin still works without cloud; features check ctx.cloud.available. Else requires 'cloud'. */
  optional?: boolean;
  /** Server functions: run on the user's provider (code in plugins/<id>/server) or an external URL. */
  functions?: Record<string, CloudFunctionDecl>;
  backend?: { kind: 'provider' } | { kind: 'external'; url: string };
  /** Static pages from plugins/<id>/web served at /w/<plugin>/<page> (viewers without the app). */
  pages?: string[];
}

export interface CloudFunctionDecl<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  title: string;
  input: I;
  output: O;
  version: number;
  timeoutMs?: number;
}

/**
 * An opaque share link (`https://<provider>/s/<id>#k=…`). Plugins can't read the URL: they show
 * it with `host.shareLink(link)` or `<QRCode link={link} />`. `JSON.stringify(link)` gives
 * "[secret link]" (and the host's `toString` too), so it can't leak into tool results or logs.
 */
export interface SecretLink {
  readonly kind: 'secret-link';
  readonly channelId: string;
  toJSON(): string;
}

export interface CloudStatus {
  provider: 'official' | 'custom' | 'off';
  baseURL?: string;
  /** The user allowed this plugin to use the cloud. */
  consented: boolean;
  online: boolean;
}

export interface PluginCloud {
  /** Provider configured, consent given and reachable (offline-tolerant reads aside). */
  readonly available: boolean;
  status(): CloudStatus;
  /** Key-value store namespaced to (device, plugin) by the provider. Values are sealed when `e2e`. */
  store: {
    get<T>(key: string): Promise<{ value: T; version: number } | undefined>;
    put<T>(key: string, value: T, opts?: { ifVersion?: number; ttlS?: number }): Promise<{ version: number }>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<{ key: string; version: number; updatedAt: number }[]>;
  };
  /** End-to-end encrypted relay channels (live sharing with people who open a link). */
  channels: {
    /** `meta` is sealed with the link key; viewers read it before joining. */
    open(opts: { ttlS: number; maxPeers?: number; page?: string; meta?: unknown }): Promise<Channel>;
    /** Survives app restarts (keys are kept in secure storage). */
    get(id: string): Channel | undefined;
    list(): Channel[];
  };
  /** Stage 6. */
  push: {
    schedule(at: number, payload: unknown): Promise<string>;
    cancel(id: string): Promise<void>;
  };
  /** Server functions declared in `CloudManifest.functions` (stage 6). */
  functions: {
    invoke<N extends string>(name: N, input: unknown, opts?: { signal?: AbortSignal }): Promise<unknown>;
  };
}

export type ChannelEventType = 'join' | 'leave' | 'message' | 'closed';

export type ChannelCloseReason = 'owner' | 'expired' | 'revoked' | 'locked' | 'server';

export type ChannelEvent =
  | { type: 'join'; peerId: string; at: number }
  | { type: 'leave'; peerId: string; at: number }
  /** A peer's frame, already decrypted (validate it with zod before use). */
  | { type: 'message'; peerId: string; msg: unknown }
  | { type: 'closed'; reason: ChannelCloseReason };

export interface Channel {
  id: string;
  expiresAt: number;
  link: SecretLink;
  peers(): { id: string; joinedAt: number }[];
  /** Subscribe; returns an unsubscribe function. */
  on(ev: ChannelEventType, fn: (e: ChannelEvent) => void): () => void;
  /** Sealed per peer; '*' = every connected peer. */
  send(peerId: string | '*', msg: unknown): Promise<void>;
  /** Sealed blobs readable by peers while the owner is offline (batch mode). */
  mailbox: {
    put(slot: string, msg: unknown, ttlS: number): Promise<void>;
    clear(): Promise<void>;
  };
  extend(ttlS: number): Promise<void>;
  close(): Promise<void>;
}

export type CloudErrorCode = 'not_configured' | 'consent_required' | 'offline' | 'rate_limited' | 'quota' | 'gone' | 'protocol' | 'server';

export const CLOUD_ERROR_CODES: readonly CloudErrorCode[] = ['not_configured', 'consent_required', 'offline', 'rate_limited', 'quota', 'gone', 'protocol', 'server'];

export class CloudError extends Error {
  readonly code: CloudErrorCode;
  /** Set for 'rate_limited' (from Retry-After). */
  readonly retryAfterS?: number;
  constructor(code: CloudErrorCode, message: string, retryAfterS?: number) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.retryAfterS = retryAfterS;
  }
}

export function isCloudError(e: unknown, code?: CloudErrorCode): e is CloudError {
  return e instanceof CloudError && (code === undefined || e.code === code);
}

export function defineCloudFunction<I extends z.ZodType, O extends z.ZodType>(d: CloudFunctionDecl<I, O>): CloudFunctionDecl<I, O> {
  return d;
}
