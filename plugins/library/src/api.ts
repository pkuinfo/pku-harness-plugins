import type { HostServices } from '@pku-harness/sdk';

import {
  icData,
  localDate,
  localStamp,
  parseHoldings,
  parseHolds,
  parseHours,
  parseJson,
  parseLoans,
  parseMembers,
  parsePickup,
  parseRenew,
  parseSearch,
  parseSpaceReservations,
  parseSpaceRooms,
  parseStudySeats,
  searchRequest,
  spaceReserveBody,
  type SearchField,
} from './parse';

/**
 * Requests to the library systems. Public hosts (opac, www) use the runtime's fetch (the SDK has
 * no public-HTTP host service); personal data goes through the harness adapters:
 * - `library` (a.lib.pku.edu.cn): `{session}` in the url/body is replaced by the adapter.
 * - `library-space` (kjyy.lib.pku.edu.cn ic-web): cookies + token header added by the adapter.
 */

type Services = Pick<HostServices, 'campus'>;

const OPAC = 'https://opac.lib.pku.edu.cn';
const WWW = 'https://www.lib.pku.edu.cn';
/** The OPAC answers ISO-8859-1 text unless asked for JSON explicitly (Spring negotiation). */
const JSON_HEADERS = { accept: 'application/json, text/plain, */*', 'content-type': 'application/json', 'accept-language': 'zh-CN,zh;q=0.9' };

async function publicJson(url: string, what: string, init: { method?: 'GET' | 'POST'; body?: string; signal?: AbortSignal } = {}) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  const onAbort = () => timeout.abort();
  init.signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { method: init.method ?? 'GET', headers: JSON_HEADERS, body: init.body, signal: timeout.signal });
    if (!res.ok) throw new Error(`${what}返回 HTTP ${res.status}`);
    return parseJson(await res.text(), what);
  } catch (e) {
    if (timeout.signal.aborted && !init.signal?.aborted) throw new Error(`${what}超时，请稍后再试`);
    throw e;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
  }
}

// ── public ────────────────────────────────────────────────────────────────────────────────────

export async function search(field: SearchField, keyword: string, page: number, rows: number, signal?: AbortSignal) {
  const req = searchRequest(field, keyword, (page - 1) * rows, rows);
  return parseSearch(await publicJson(`${OPAC}${req.path}`, '馆藏检索', { method: 'POST', body: req.body, signal }));
}

/** `id` is the search result id (already URL-encoded by the OPAC, e.g. "e0f4…Mw%3D%3D"). */
export async function holdings(id: string, signal?: AbortSignal) {
  const enc = /%[0-9A-F]{2}/i.test(id) ? id : encodeURIComponent(id);
  return parseHoldings(id, await publicJson(`${OPAC}/BookAPI/new_opac/query_detail?cat_marc=${enc}`, '馆藏详情', { signal }));
}

export async function hoursToday(signal?: AbortSignal) {
  return parseHours(await publicJson(`${WWW}/cms/opening-hours/getday`, '开馆时间', { signal }));
}

/** psgSeatMenu answers without a session (研修专座 floors and remaining seats). */
export async function studySeats(signal?: AbortSignal) {
  return parseStudySeats(icData(await publicJson('https://kjyy.lib.pku.edu.cn/ic-web/psgSeatMenu', '研修专座', { signal }), '查询研修专座'));
}

// ── 个人中心 (library) ─────────────────────────────────────────────────────────────────────────

async function lib(services: Services, url: string, init: { method?: 'GET' | 'POST'; json?: unknown } = {}) {
  const res = await services.campus.request('library', {
    url,
    method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    contentType: init.json === undefined ? undefined : 'application/json;charset=utf-8',
  });
  if (res.status >= 400) throw new Error(`图书馆个人中心返回 HTTP ${res.status}`);
  return parseJson(res.body, '图书馆个人中心');
}

/** Everything the portal shows on 我的借阅 (getMyInfobySession). Also validates the session. */
export async function account(services: Services) {
  return lib(services, '/prod-api/auth/getMyInfobySession?pkulib_session={session}');
}

export async function loans(services: Services) {
  return parseLoans(await account(services), localDate(new Date()));
}

export async function holds(services: Services) {
  return parseHolds(await account(services));
}

/** Loan-List-Page renewItem2: POST with query params itemBarcode, pkulibSession, source=2. */
export async function renew(services: Services, itemId: string) {
  const j = await lib(services, `/prod-api/circ/renewItem2?itemBarcode=${encodeURIComponent(itemId)}&pkulibSession={session}&source=2`, { method: 'POST' });
  return parseRenew(j);
}

/** hold-list cancelHold: JSON body; success when desc is "取消预约成功". */
export async function cancelHold(services: Services, hold: { itemId: string | null; callNumber: string | null; changping: boolean; taskId: string | null }) {
  const j = hold.changping
    ? await lib(services, '/prod-api/circ/cancelChangpingHold', { json: { pkulibSession: '{session}', taskID: hold.taskId } })
    : await lib(services, '/prod-api/circ/cancelHold', { json: { itemBarcode: hold.itemId, callNumber: hold.callNumber, pkulibSession: '{session}', cancelReason: '不想要了' } });
  const data = (j.data ?? {}) as Record<string, unknown>;
  const desc = String(j.desc ?? data.desc ?? '');
  const ok = hold.changping ? data.status === 0 || j.status === 0 : desc === '取消预约成功';
  return { ok, message: desc || (ok ? '取消预约成功' : '取消预约失败') };
}

export async function pickupOptions(services: Services, itemId: string) {
  return parsePickup(await lib(services, '/prod-api/circ/advisePickupAt', { json: { itemBarcode: itemId, pkulibSession: '{session}' } }));
}

/** OPAC "预约" button: createHold { callNumber, expireDate: "", itemBarcode, pickupAt, pkulibSession }; status 0 = ok. */
export async function createHold(services: Services, input: { itemId: string; callNumber: string; pickupAt: string }) {
  const j = await lib(services, '/prod-api/circ/createHold', {
    json: { callNumber: input.callNumber, expireDate: '', itemBarcode: input.itemId, pickupAt: input.pickupAt, pkulibSession: '{session}' },
  });
  const data = (j.data ?? {}) as Record<string, unknown>;
  const status = j.status ?? data.status;
  const desc = String(j.desc ?? data.desc ?? j.msg ?? '');
  return { ok: status === 0 || status === '0', message: desc };
}

// ── IC 空间 (library-space) ────────────────────────────────────────────────────────────────────

async function ic(services: Services, path: string, what: string, json?: unknown) {
  const res = await services.campus.request('library-space', {
    url: `/ic-web/${path}`,
    method: json === undefined ? 'GET' : 'POST',
    body: json === undefined ? undefined : JSON.stringify(json),
    contentType: json === undefined ? undefined : 'application/json; charset=UTF-8',
  });
  if (res.status >= 400) throw new Error(`空间预约系统返回 HTTP ${res.status}`);
  return icData(parseJson(res.body, '空间预约系统'), what);
}

export async function me(services: Services): Promise<{ accNo: string | null; name: string | null }> {
  const d = (await ic(services, 'auth/userInfo', '读取账号')) as Record<string, unknown> | null;
  return { accNo: d?.accNo != null ? String(d.accNo) : null, name: typeof d?.trueName === 'string' ? d.trueName : null };
}

/** 研讨室 kind id (roomMenu: kindId 1 "研讨室"). */
export const ROOM_KIND = 1;

export async function spaceRooms(services: Services, date: string) {
  const ymd = date.replace(/-/g, '');
  const data = await ic(services, `reserve?sysKind=1&kindIds=${ROOM_KIND}&resvDates=${ymd}&page=1&pageNum=50&pageSize=50`, '查询研讨室');
  return parseSpaceRooms(data, date, localStamp(new Date()));
}

export async function spaceReservations(services: Services, from: string, to: string) {
  const [who, data] = await Promise.all([
    me(services),
    ic(services, `reserve/resvInfo?beginDate=${from}&endDate=${to}&needStatus=0&page=1&pageNum=50&orderKey=gmt_create&orderModel=desc`, '查询我的预约'),
  ]);
  return parseSpaceReservations(data, who.accNo);
}

export async function findMember(services: Services, key: string) {
  return parseMembers(await ic(services, `account/getMembers?key=${encodeURIComponent(key)}&page=1&pageNum=10`, '查找预约人'));
}

export async function reserveSpace(services: Services, input: Parameters<typeof spaceReserveBody>[0]) {
  const res = await services.campus.request('library-space', {
    url: '/ic-web/reserve',
    method: 'POST',
    body: JSON.stringify(spaceReserveBody(input)),
    contentType: 'application/json; charset=UTF-8',
  });
  const j = parseJson(res.body, '空间预约系统');
  return { ok: j.code === 0, message: typeof j.message === 'string' ? j.message : '' };
}

export async function cancelSpace(services: Services, uuid: string) {
  const res = await services.campus.request('library-space', {
    url: '/ic-web/reserve/delete',
    method: 'POST',
    body: JSON.stringify({ uuid }),
    contentType: 'application/json; charset=UTF-8',
  });
  const j = parseJson(res.body, '空间预约系统');
  return { ok: j.code === 0, message: typeof j.message === 'string' ? j.message : '' };
}
