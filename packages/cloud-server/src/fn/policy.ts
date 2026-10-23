/**
 * Which plugins' server functions this server runs (docs/CLOUD-FUNCTIONS.md §7, CLOUD_FN_POLICY):
 *
 * - `verified`: only (plugin, hash) pairs pinned in the registry's verified list
 *   (`CLOUD_FN_VERIFIED`, re-read when the file changes).
 * - `allowlist`: the operator's `CLOUD_FN_ALLOW` entries, `plugin@<hash>` or `plugin@*`.
 * - `open`: any document (local development, a server for one group).
 *
 * Entries may name the document's link (`plugin@<hash>=<link>`, or `link` in the verified file):
 * public functions (`/v1/p`) have no token to carry one, so that is where their document comes from.
 */
import { readFileSync, statSync } from 'node:fs';

import { type DocClaim, type FunctionPolicy, docClaimSchema, docHashSchema, pluginIdSchema } from '@pku-harness/cloud-protocol';
import { z } from 'zod';

import type { FunctionsConfig } from '../config';

type Entry = { hashes: Set<string> | '*'; link?: string };

const verifiedFile = z.record(pluginIdSchema, z.union([z.array(docHashSchema), z.object({ link: z.string().optional(), hashes: z.array(docHashSchema) })]));

export function parseAllow(list: string[]): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const raw of list) {
    const m = /^([a-z0-9][a-z0-9-]{1,63})@(\*|[0-9a-f]{64})(?:=(\S+))?$/.exec(raw);
    if (!m) throw new Error(`CLOUD_FN_ALLOW: '${raw}' is not plugin@<sha256 hex>, plugin@* or plugin@<hash>=<link>`);
    const [, plugin, hash, link] = m as unknown as [string, string, string, string | undefined];
    const e = out.get(plugin) ?? { hashes: new Set<string>() };
    if (hash === '*') e.hashes = '*';
    else if (e.hashes !== '*') e.hashes.add(hash);
    if (link) e.link = link;
    out.set(plugin, e);
  }
  return out;
}

export class FnPolicy {
  private allow: Map<string, Entry>;
  private verified = new Map<string, Entry>();
  private verifiedMtime = -1;
  /** The last hash listed per plugin (the one `/v1/p` serves). */
  private latest = new Map<string, string>();

  constructor(private readonly cfg: Pick<FunctionsConfig, 'policy' | 'allow' | 'verifiedFile'>) {
    this.allow = parseAllow(cfg.allow);
    for (const raw of cfg.allow) {
      const m = /^([^@]+)@([0-9a-f]{64})/.exec(raw);
      if (m) this.latest.set(m[1]!, m[2]!);
    }
    if (cfg.policy === 'verified') {
      if (!cfg.verifiedFile) throw new Error('CLOUD_FN_POLICY=verified needs CLOUD_FN_VERIFIED (a JSON file of pinned hashes)');
      this.refresh();
    }
  }

  get policy(): FunctionPolicy {
    return this.cfg.policy;
  }

  /** Re-read the verified file when it changed (cheap stat per check). */
  private refresh() {
    const file = this.cfg.verifiedFile;
    if (!file) return;
    let mtime: number;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      throw new Error(`CLOUD_FN_VERIFIED: can't read ${file}`);
    }
    if (mtime === this.verifiedMtime) return;
    const parsed = verifiedFile.parse(JSON.parse(readFileSync(file, 'utf8')));
    this.verified = new Map();
    for (const [plugin, v] of Object.entries(parsed)) {
      const hashes = Array.isArray(v) ? v : v.hashes;
      this.verified.set(plugin, { hashes: new Set(hashes), link: Array.isArray(v) ? undefined : v.link });
      if (hashes.length) this.latest.set(plugin, hashes[hashes.length - 1]!);
    }
    this.verifiedMtime = mtime;
  }

  private table(): Map<string, Entry> | undefined {
    if (this.cfg.policy === 'verified') {
      this.refresh();
      return this.verified;
    }
    return this.cfg.policy === 'allowlist' ? this.allow : undefined;
  }

  allows(plugin: string, hash: string): boolean {
    const t = this.table();
    if (!t) return true;
    const e = t.get(plugin);
    return !!e && (e.hashes === '*' || e.hashes.has(hash));
  }

  /** Link + hash of a plugin's document for public functions, when the operator listed one. */
  publicDoc(plugin: string): DocClaim | undefined {
    const e = (this.table() ?? this.allow).get(plugin);
    const hash = this.latest.get(plugin);
    if (!e?.link || !hash) return undefined;
    const claim = { link: e.link, hash };
    return docClaimSchema.safeParse(claim).success ? claim : undefined;
  }
}
