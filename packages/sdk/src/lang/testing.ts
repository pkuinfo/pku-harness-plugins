import type { CampusRequest } from '../campus';
import type { HostServices, KV } from '../plugin';
import type { PluginDocument } from './load';
import { inputZod } from './compile';
import { runTool, type PublicFetch, type RunEnv } from './run';
import type { TestDoc } from './schema';

/**
 * Replay a plugin tool against recorded responses (docs/PLUGIN-LANGUAGE.md §12): the CLI's
 * `plugin test` and the SDK's own tests. Each response matches the first request whose URL
 * contains `match` (and whose campus service equals `campus`, when given); it is used once.
 */

export type Recorded = NonNullable<TestDoc['responses']>[number] & { text?: string };
export type SeenRequest = { campus?: string; url: string; method: string; body?: string; headers: Record<string, string> };

export function memoryKV(init: Record<string, unknown> = {}): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(init));
  return {
    data,
    get: async <T>(k: string) => (data.has(k) ? (structuredClone(data.get(k)) as T) : undefined),
    set: async <T>(k: string, v: T) => void data.set(k, structuredClone(v)),
    delete: async (k: string) => void data.delete(k),
  } as KV & { data: Map<string, unknown> };
}

export function replayEnv(doc: PluginDocument, responses: Recorded[], opts: { now?: number; kv?: Record<string, unknown>; services?: Partial<HostServices> } = {}) {
  const pool = [...responses];
  const seen: SeenRequest[] = [];
  const take = (campus: string | undefined, url: string) => {
    const i = pool.findIndex((r) => url.includes(r.match) && (r.campus === undefined || r.campus === campus));
    if (i < 0) throw new Error(`no recorded response for ${campus ? `[${campus}] ` : ''}${url}`);
    const [r] = pool.splice(i, 1);
    const body = r!.text ?? (typeof r!.body === 'string' ? r!.body : JSON.stringify(r!.body ?? null));
    return { status: r!.status ?? 200, url: r!.url ?? url, headers: { 'content-type': typeof r!.body === 'string' ? 'text/html' : 'application/json', ...(r!.headers ?? {}) }, body };
  };
  const fetch: PublicFetch = async (req) => {
    seen.push({ url: req.url, method: req.method, body: req.body, headers: req.headers });
    return take(undefined, req.url);
  };
  const services = {
    ...opts.services,
    campus: {
      ...(opts.services?.campus ?? {}),
      request: async (service: string, req: CampusRequest) => {
        seen.push({ campus: service, url: req.url, method: req.method ?? 'GET', body: typeof req.body === 'string' ? req.body : undefined, headers: req.headers ?? {} });
        return take(service, req.url);
      },
      otp: opts.services?.campus?.otp ?? (async () => null),
    },
  } as unknown as HostServices;
  const kv = memoryKV(opts.kv);
  const env: RunEnv = { manifest: doc.manifest, tools: doc.tools, services, kv, fetch, now: opts.now === undefined ? undefined : () => opts.now! };
  return { env, seen, kv, unused: () => pool };
}

/** Run one recorded test; returns the result or throws with the tool's error. */
export async function runRecorded(doc: PluginDocument, t: TestDoc, files: Record<string, string> = {}) {
  const responses: Recorded[] = (t.responses ?? []).map((r) => (r.file ? { ...r, text: files[r.file] ?? '' } : r));
  const now = t.now === undefined ? undefined : typeof t.now === 'number' ? t.now : Date.parse(t.now.includes('T') || /[zZ+]/.test(t.now) ? t.now : `${t.now.replace(' ', 'T')}+08:00`);
  const { env, seen } = replayEnv(doc, responses, { now, kv: t.kv });
  // Validate and default the input exactly as the app does before a tool runs.
  const input = inputZod(doc.tools[t.tool]?.input).parse(t.input ?? {}) as Record<string, unknown>;
  const result = await runTool(env, t.tool, input);
  return { result, seen };
}
