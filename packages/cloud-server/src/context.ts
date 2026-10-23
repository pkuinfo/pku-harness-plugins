/** Shared dependencies and the Hono environment type. */
import type { TokenClaims } from '@pku-harness/cloud-protocol';
import type { Server } from 'bun';

import type { PowGate } from './auth/pow';
import type { TokenSigner } from './auth/token';
import type { Hub } from './channels/hub';
import type { Config } from './config';
import type { Storage } from './db/storage';
import type { DocCache } from './fn/docs';
import type { FnPolicy } from './fn/policy';
import type { ResultCache } from './routes/fn';
import type { RateLimiter, Take } from './limits';
import type { Logger } from './log';
import type { PageRegistry } from './pages';

export interface Deps {
  config: Config;
  storage: Storage;
  tokens: TokenSigner;
  pow: PowGate;
  limiter: RateLimiter;
  hub: Hub;
  pages: PageRegistry;
  /** Plugin server functions: policy, compiled documents, public results, outbound fetch. */
  fn: { policy: FnPolicy; docs: DocCache; results: ResultCache; fetch: typeof fetch };
  log: Logger;
  /** Clock (ms); injectable for tests. */
  now: () => number;
  /** Normalised public origin (`aud`). */
  aud: string;
}

/** What a WebSocket carries from the upgrade to Bun's websocket handlers. */
export type SocketData = { kind: 'owner'; channelId: string; maxPeers: number } | { kind: 'peer'; channelId: string; peerId: string };

export interface AppEnv {
  Bindings: { server?: Server<SocketData> };
  Variables: { ip: string; rl?: Take; auth: TokenClaims };
}
