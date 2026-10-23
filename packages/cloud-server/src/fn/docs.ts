/**
 * Plugin documents for server functions (docs/CLOUD-FUNCTIONS.md §7): fetch a document by the
 * link the device consented to, recompute its content hash exactly as the app does
 * (`sha256hex(fingerprintText(files))`), refuse mismatches, and keep the compiled `server:`
 * section per (plugin, hash) in an LRU. With `CLOUD_FN_LOCAL` a plugin folder on disk
 * (`<dir>/<id>/PLUGIN.md`) is used instead of the link — the hash must still match.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import type { DocClaim } from '@pku-harness/cloud-protocol';
import { fileUrl, LinkError, resolveLink } from '@pku-harness/sdk/lang/link';
import { fingerprintText, loadDocument, PluginDocError, type ReadFile } from '@pku-harness/sdk/lang/load';
import type { Manifest } from '@pku-harness/sdk/lang/schema';
import type { ServerDoc, ServerFunctionDoc } from '@pku-harness/sdk/lang/server-schema';

import { HttpError } from '../errors';

export interface CompiledDoc {
  plugin: string;
  hash: string;
  manifest: Manifest;
  server: ServerDoc;
  functions: Record<string, ServerFunctionDoc>;
}

/** The content hash the app records at install (`services.crypto.sha256(fingerprintText(files))`). */
export function documentHash(files: Record<string, string>): string {
  return createHash('sha256').update(fingerprintText(files), 'utf8').digest('hex');
}

const MAX_FILE_BYTES = 512_000;
const FETCH_TIMEOUT_MS = 10_000;
const FAILURE_TTL_MS = 30_000;

export interface DocCacheOptions {
  fetch: typeof fetch;
  localDir?: string;
  /** Allow `http://localhost` links (policy `open` only). */
  allowLocalHttp: boolean;
  max: number;
  now: () => number;
}

export class DocCache {
  private lru = new Map<string, CompiledDoc>();
  private inflight = new Map<string, Promise<CompiledDoc>>();
  private failures = new Map<string, { err: HttpError; until: number }>();

  constructor(private readonly opts: DocCacheOptions) {}

  get size() {
    return this.lru.size;
  }

  /** The document `claim` names, verified against its hash. */
  async get(plugin: string, claim: DocClaim): Promise<CompiledDoc> {
    const key = `${plugin}@${claim.hash}`;
    const hit = this.lru.get(key);
    if (hit) {
      this.lru.delete(key);
      this.lru.set(key, hit);
      return hit;
    }
    const failKey = `${key} ${claim.link}`;
    const failed = this.failures.get(failKey);
    if (failed && failed.until > this.opts.now()) throw failed.err;
    let p = this.inflight.get(failKey);
    if (!p) {
      p = this.load(plugin, claim).finally(() => this.inflight.delete(failKey));
      this.inflight.set(failKey, p);
    }
    try {
      return await p;
    } catch (e) {
      // Don't refetch a broken or mismatching document on every call.
      if (e instanceof HttpError && e.code !== 'server') this.failures.set(failKey, { err: e, until: this.opts.now() + FAILURE_TTL_MS });
      if (this.failures.size > 256) this.failures.delete(this.failures.keys().next().value!);
      throw e;
    }
  }

  /** The local copy of a plugin (`CLOUD_FN_LOCAL`), whatever its hash; undefined without one. */
  async local(plugin: string): Promise<CompiledDoc | undefined> {
    const read = this.localReader(plugin);
    if (!read) return undefined;
    return this.compile(plugin, read, undefined);
  }

  private localReader(plugin: string): ReadFile | undefined {
    const dir = this.opts.localDir;
    if (!dir) return undefined;
    const root = resolve(dir, plugin);
    if (!existsSync(join(root, 'PLUGIN.md'))) return undefined;
    return async (path) => {
      const full = resolve(root, path);
      if (!full.startsWith(root + sep)) throw new Error(`${path}: outside the plugin folder`);
      return readFile(full, 'utf8');
    };
  }

  private async load(plugin: string, claim: DocClaim): Promise<CompiledDoc> {
    const local = this.localReader(plugin);
    if (local) return this.compile(plugin, local, claim.hash);
    if (claim.link.startsWith('file:')) throw new HttpError('not_found', `this server has no local copy of ${plugin} (CLOUD_FN_LOCAL)`);
    if (claim.link.startsWith('http:')) {
      if (!this.opts.allowLocalHttp) throw new HttpError('forbidden', 'http:// document links are accepted only by servers with CLOUD_FN_POLICY=open');
      const url = /\/PLUGIN\.md$/i.test(new URL(claim.link).pathname) ? claim.link : claim.link.replace(/\/?$/, '/PLUGIN.md');
      return this.compile(plugin, this.remoteReader([url], true), claim.hash);
    }
    let candidates: string[];
    try {
      candidates = resolveLink(claim.link).candidates;
    } catch (e) {
      throw new HttpError('bad_request', e instanceof LinkError ? `document link: ${e.message}` : 'document link is not usable');
    }
    return this.compile(plugin, this.remoteReader(candidates, false), claim.hash);
  }

  private async fetchText(url: string, allowHttp: boolean): Promise<string> {
    const u = new URL(url);
    if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) throw new Error('documents are fetched over https only');
    const res = await this.opts.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'text/plain, */*' } });
    if (res.url && !res.url.startsWith('https:') && !(allowHttp && res.url.startsWith('http:'))) throw new Error('document redirected off https');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_FILE_BYTES) throw new Error('document file too large');
    return text;
  }

  /** PLUGIN.md from the first candidate that answers; other files relative to it. */
  private remoteReader(candidates: string[], allowHttp: boolean): ReadFile {
    let base: string | undefined;
    return async (path) => {
      if (path === 'PLUGIN.md' && !base) {
        let last: unknown;
        for (const url of candidates) {
          try {
            const text = await this.fetchText(url, allowHttp);
            base = url;
            return text;
          } catch (e) {
            last = e;
          }
        }
        throw new HttpError('not_found', `the plugin document could not be fetched (${last instanceof Error ? last.message : 'error'})`);
      }
      return this.fetchText(fileUrl(base!, path), allowHttp);
    };
  }

  private async compile(plugin: string, read: ReadFile, expected: string | undefined): Promise<CompiledDoc> {
    let doc;
    try {
      doc = await loadDocument(read);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof PluginDocError) throw new HttpError('failed', `the plugin document is invalid: ${e.issues[0] ?? e.message}`);
      throw new HttpError('not_found', `the plugin document could not be loaded (${e instanceof Error ? e.message : 'error'})`);
    }
    const hash = documentHash(doc.files);
    if (expected !== undefined && hash !== expected) throw new HttpError('conflict', 'the document at the link does not match the consented version (hash mismatch); update the plugin');
    if (doc.manifest.id !== plugin) throw new HttpError('conflict', `the document is plugin '${doc.manifest.id}', not '${plugin}'`);
    const key = `${plugin}@${hash}`;
    const cached = this.lru.get(key);
    if (cached) return cached;
    const server = (doc.manifest.server ?? {}) as ServerDoc;
    const compiled: CompiledDoc = { plugin, hash, manifest: doc.manifest, server, functions: server.functions ?? {} };
    this.lru.set(key, compiled);
    while (this.lru.size > this.opts.max) this.lru.delete(this.lru.keys().next().value!);
    return compiled;
  }
}
