import type { KV } from '@pku-harness/sdk';

import { HOURS_SNAPSHOT, HOURS_SOURCE } from './data';
import { getText } from './http';
import { parseCanteenNotices, parseCrowd, parseHours, type CanteenNotice, type Venue } from './parse';

const PORTAL = 'https://portal.pku.edu.cn/publicQuery';
const NOTICES = 'https://cyzx.pku.edu.cn/tzgg/index.htm';

/** CanteenController.js: POST, JSON content type, no body; the portal's public pages send this referer. */
export async function fetchCrowd(signal?: AbortSignal) {
  const body = await getText(`${PORTAL}/canteenQuery/retrCarteenInfos.do`, {
    method: 'POST',
    contentType: 'application/json; charset=UTF-8',
    headers: { referer: `${PORTAL}/`, accept: 'application/json, text/plain, */*' },
    signal,
  });
  return parseCrowd(body);
}

const DAY = 24 * 3_600_000;

type CachedHours = { at: number; updated: string | null; venues: Venue[] };

/**
 * Opening hours from 餐饮中心 (cached a day). Falls back to the last good copy, then to the
 * bundled snapshot, saying which one was used.
 */
export async function fetchHours(kv: KV, signal?: AbortSignal): Promise<{ venues: Venue[]; updated: string | null; origin: 'live' | 'cache' | 'snapshot'; error?: string }> {
  const cached = await kv.get<CachedHours>('hours');
  if (cached && Date.now() - cached.at < DAY) return { venues: cached.venues, updated: cached.updated, origin: 'cache' };
  try {
    const { updated, venues } = parseHours(await getText(HOURS_SOURCE.url, { signal }));
    await kv.set<CachedHours>('hours', { at: Date.now(), updated, venues });
    return { venues, updated, origin: 'live' };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (cached) return { venues: cached.venues, updated: cached.updated, origin: 'cache', error };
    return { venues: HOURS_SNAPSHOT, updated: HOURS_SOURCE.published, origin: 'snapshot', error };
  }
}

type CachedNotices = { at: number; items: CanteenNotice[] };

/** 餐饮中心 通知公告, cached 6 hours. */
export async function fetchCanteenNotices(kv: KV, signal?: AbortSignal): Promise<CanteenNotice[]> {
  const cached = await kv.get<CachedNotices>('notices');
  if (cached && Date.now() - cached.at < DAY / 4) return cached.items;
  try {
    const items = parseCanteenNotices(await getText(NOTICES, { signal }), NOTICES);
    await kv.set<CachedNotices>('notices', { at: Date.now(), items });
    return items;
  } catch (e) {
    if (cached) return cached.items;
    throw e;
  }
}
