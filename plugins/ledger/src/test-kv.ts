import type { KV, ToolContext } from '@pku-harness/sdk';

/** In-memory KV for tests (values are cloned like the app's JSON store). */
export function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async <T,>(k: string) => (data.has(k) ? (JSON.parse(data.get(k)!) as T) : undefined),
    set: async <T,>(k: string, v: T) => void data.set(k, JSON.stringify(v)),
    delete: async (k: string) => void data.delete(k),
  };
}

export const ctxOf = (kv: KV, actor: ToolContext['actor'] = 'agent'): ToolContext => ({ pluginId: 'ledger', actor, kv, services: {} as ToolContext['services'] });
