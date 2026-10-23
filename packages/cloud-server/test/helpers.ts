import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type CloudServiceName,
  type DeviceIdentity,
  deriveShareKeys,
  generateBoxKeyPair,
  generateDeviceIdentity,
  generateShareSecret,
  joinHash,
  metaResponse,
  paths,
  seal,
  signAuthChallenge,
  solvePow,
  toB64url,
} from '@pku-harness/cloud-protocol';

import { type CloudServer, createServer } from '../src/app';
import { type Config, type RateConfig, defaultConfig } from '../src/config';
import { memoryLogger } from '../src/log';

export const PUBLIC_URL = 'http://localhost:8787';

/** A plugins dir with `card-share/web/dist/view.html` and an asset. */
export function pagesFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cloud-pages-'));
  const dist = join(dir, 'card-share', 'web', 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'view.html'), '<!doctype html><title>view</title><script type="module" src="./assets/app.js"></script>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("viewer")');
  writeFileSync(join(dir, 'card-share', 'secret.txt'), 'outside dist');
  return dir;
}

export interface TestServer extends CloudServer {
  clock: { now: number; advance(ms: number): void };
  log: ReturnType<typeof memoryLogger>;
  request(path: string, init?: RequestInit & { json?: unknown; token?: string }): Promise<Response>;
}

export async function makeServer({ fetch, ...opts }: Partial<Omit<Config, 'rates'>> & { rates?: Partial<RateConfig>; fetch?: typeof globalThis.fetch } = {}): Promise<TestServer> {
  const clock = {
    now: Date.now(),
    advance(ms: number) {
      clock.now += ms;
    },
  };
  const log = memoryLogger();
  const config = defaultConfig({ dbPath: ':memory:', powDifficulty: 4, publicURL: PUBLIC_URL, pagesDir: pagesFixture(), trustProxy: true, gcIntervalMs: 3600_000, ...opts });
  const s = await createServer(config, { log, now: () => clock.now, fetch });
  return {
    ...s,
    clock,
    log,
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (init.json !== undefined) headers.set('content-type', 'application/json');
      if (init.token) headers.set('authorization', `Bearer ${init.token}`);
      if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', '10.0.0.1');
      return s.app.request(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
    },
  };
}

export interface TestDevice {
  id: string;
  identity: DeviceIdentity;
}

export async function registerDevice(s: TestServer, ip = '10.0.0.1'): Promise<TestDevice> {
  const meta = metaResponse.parse(await (await s.request(paths.meta())).json());
  const identity = generateDeviceIdentity();
  const signPub = toB64url(identity.sign.publicKey);
  const boxPub = toB64url(identity.box.publicKey);
  const { nonce } = await solvePow({ salt: meta.pow.salt, signPub, boxPub }, meta.pow.difficulty);
  const r = await s.request(paths.devices(), { method: 'POST', json: { signPub, boxPub, pow: { salt: meta.pow.salt, nonce } }, headers: { 'x-forwarded-for': ip } });
  if (r.status !== 200) throw new Error(`register failed: ${r.status} ${await r.text()}`);
  return { id: ((await r.json()) as { deviceId: string }).deviceId, identity };
}

export function challenge(s: TestServer, dev: TestDevice, plugin: string, services: CloudServiceName[], aud = PUBLIC_URL) {
  return signAuthChallenge({ aud, deviceId: dev.id, plugin, services, now: s.clock.now }, dev.identity.sign.secretKey);
}

export async function tokenFor(s: TestServer, dev: TestDevice, plugin: string, services: CloudServiceName[] = ['store', 'channels']): Promise<string> {
  const r = await s.request(paths.authToken(), { method: 'POST', json: challenge(s, dev, plugin, services) });
  if (r.status !== 200) throw new Error(`token failed: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { token: string }).token;
}

/** Everything the sharer's phone keeps for one channel. */
export function shareKeys() {
  const k = generateShareSecret();
  const { authKey, encKey } = deriveShareKeys(k);
  const chan = generateBoxKeyPair();
  return { k, authKey, encKey, chan };
}

export function channelBody(keys: ReturnType<typeof shareKeys>, extra: Record<string, unknown> = {}) {
  return {
    ttlS: 900,
    maxPeers: 1,
    joinHash: joinHash(keys.authKey),
    chanPub: toB64url(keys.chan.publicKey),
    meta: seal(keys.encKey, { nameHint: '王_明', pinRequired: false }),
    ...extra,
  };
}

export async function json<T = Record<string, unknown>>(r: Response): Promise<T> {
  return (await r.json()) as T;
}
