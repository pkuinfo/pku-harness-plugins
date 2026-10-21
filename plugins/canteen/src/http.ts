/**
 * Public, unauthenticated HTTP through the JS runtime's `fetch` (the plugin's 'network' capability),
 * as in plugins/calendar/src/api.ts. Copied from plugins/notices/src/http.ts: plugins never import
 * each other.
 */

/** pkucli client::build_simple: desktop UA + Chinese accept-language. */
export const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
/** These responses are a few KB; refuse anything absurd on a phone. */
const MAX_BYTES = 2_000_000;

export type GetOptions = { method?: 'GET' | 'POST'; body?: string; contentType?: string; headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number };

export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? 15_000);
  const onAbort = () => timeout.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const host = /^https?:\/\/([^/]+)/.exec(url)?.[1] ?? url;
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      headers: {
        'user-agent': DESKTOP_UA,
        'accept-language': 'zh-CN,zh;q=0.9',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
        ...(opts.contentType ? { 'content-type': opts.contentType } : {}),
        ...opts.headers,
      },
      signal: timeout.signal,
    });
    if (!res.ok) throw new Error(`${host} 返回 HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error(`${host} 的页面异常地大，已放弃`);
    return text;
  } catch (e) {
    if (timeout.signal.aborted && !opts.signal?.aborted) throw new Error(`访问 ${host} 超时，请稍后再试`);
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
