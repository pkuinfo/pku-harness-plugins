/**
 * Public, unauthenticated HTTP for the notice sites (same approach as plugins/calendar/src/api.ts:
 * the SDK has no host service for public hosts, so this uses the JS runtime's `fetch` — the
 * plugin's 'network' capability). No cookies, no redirects to handle, all pages are UTF-8.
 */

/** pkucli client::build_simple: desktop UA + Chinese accept-language. */
export const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
/**
 * mp.weixin.qq.com articles. pkucli info-spider scrape.rs sends a MicroMessenger UA, but (checked
 * 2026-10-21) WeChat now answers that UA from outside the app with "未知错误"; a plain mobile
 * browser UA gets the full article.
 */
export const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

/** WeChat article pages are ~3–4 MB of inline JS; anything far beyond that is not an article. */
const MAX_BYTES = 8_000_000;

export type GetOptions = { method?: 'GET' | 'POST'; body?: string; contentType?: string; mobile?: boolean; signal?: AbortSignal; timeoutMs?: number };

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
        'user-agent': opts.mobile ? MOBILE_UA : DESKTOP_UA,
        'accept-language': 'zh-CN,zh;q=0.9',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
        ...(opts.contentType ? { 'content-type': opts.contentType } : {}),
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
