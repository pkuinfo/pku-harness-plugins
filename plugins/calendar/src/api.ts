import type { KV } from '@pku-harness/sdk';

import { bundlePath, parseBundle, type CalendarYear } from './parse';

/** pkucli crates/portal/src/client.rs SIMSO_BASE + calendar.rs ENTRY_PATH. */
const SIMSO = 'https://simso.pku.edu.cn';
const ENTRY = `${SIMSO}/pages/ccSchoolCalendar.html`;
/** pkucli client::build_simple sends a desktop UA and a Chinese accept-language. */
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'accept-language': 'zh,zh-CN;q=0.9',
};
/** The bundle is a few hundred KB; refuse anything absurd on a phone. */
const MAX_BYTES = 3_000_000;
const TTL = 24 * 3_600_000;

/**
 * Public, unauthenticated GET. The SDK has no host HTTP service for public hosts yet
 * (`services.campus.request` needs a signed-in campus service), so this uses the JS runtime's
 * `fetch` — the plugin's 'network' capability. simso needs no cookies or redirect handling.
 */
async function get(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: timeout.signal });
    if (!res.ok) throw new Error(`校历网站返回 HTTP ${res.status}`);
    const body = await res.text();
    if (body.length > MAX_BYTES) throw new Error('校历文件异常地大，已放弃');
    return body;
  } catch (e) {
    if (timeout.signal.aborted && !signal?.aborted) throw new Error('访问校历网站（simso.pku.edu.cn）超时，请稍后再试');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

type Cached = { at: number; years: CalendarYear[] };

/** Every academic year on simso (calendar.rs fetch): entry page → hashed bundle → parse. Cached a day. */
export async function fetchCalendar(kv: KV, opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<CalendarYear[]> {
  const cached = await kv.get<Cached>('official');
  if (!opts.force && cached && Date.now() - cached.at < TTL) return cached.years;
  try {
    const html = await get(ENTRY, opts.signal);
    const rel = bundlePath(html);
    if (!rel) throw new Error('校历页面里没找到校历数据文件，simso 可能已改版');
    const years = parseBundle(await get(`${SIMSO}/${rel}`, opts.signal));
    await kv.set<Cached>('official', { at: Date.now(), years });
    return years;
  } catch (e) {
    // Offline or simso down: an older copy is better than nothing.
    if (cached) return cached.years;
    throw e;
  }
}
