/**
 * Pure parsers for the PKU Library services (no network, no SDK). Shapes were captured from the
 * live sites in 2026-10 (pkucli does not cover the library):
 * - opac.lib.pku.edu.cn  `/BookAPI/new_opac/query` (Solr docs) and `/query_detail` (SirsiDynix
 *   Symphony TitleInfo → CallInfo → ItemInfo), public.
 * - a.lib.pku.edu.cn     `/prod-api/auth/getMyInfobySession` (patronInfo, patronCheckoutInfo,
 *   patronHoldInfo), `/circ/renewItem2`, `/circ/cancelHold`, `/circ/advisePickupAt`.
 * - www.lib.pku.edu.cn   `/cms/opening-hours/getday`, public.
 * - kjyy.lib.pku.edu.cn  Unifound ic-web: `/ic-web/reserve` (devices + resvInfo),
 *   `/ic-web/reserve/resvInfo` (my reservations), `/ic-web/psgSeatMenu` (研修专座, public).
 * Every field is read defensively: these are third-party systems that change without notice.
 */

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => v != null && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};
/** Solr fields are arrays of strings; take the first non-empty one. */
const first = (v: unknown): string | null => (Array.isArray(v) ? (v.map(str).find(Boolean) ?? null) : str(v));
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const uniq = <T>(xs: T[]) => [...new Set(xs)];

export function parseJson(body: string, what: string): Json {
  try {
    const j = JSON.parse(body) as unknown;
    if (isObj(j)) return j;
  } catch {
    // fall through
  }
  throw new Error(`${what}返回了无法解析的内容`);
}

/** Untrusted free text from the library systems: plain, single-spaced, capped. */
export function plain(v: unknown, max = 200): string | null {
  const s = str(v);
  if (!s) return null;
  const t = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ── dates ─────────────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localStamp = (d: Date) => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Epoch ms, "2026-11-05T23:59:00.000+08:00", "2026-11-05 08:00:00" or "2026/11/5 8:00" → local
 * "YYYY-MM-DD HH:mm" (date only when the input has no time). null when unreadable.
 */
export function stampOf(v: unknown): string | null {
  const n = num(v);
  if (n != null && n > 1e11) return localStamp(new Date(n));
  const s = str(v);
  if (!s) return null;
  // ISO with an offset/Z: convert to device-local time.
  if (/T\d{2}:\d{2}/.test(s) && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return localStamp(d);
  }
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const date = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return m[4] ? `${date} ${pad(Number(m[4]))}:${m[5]}` : date;
}

export const dateOf = (v: unknown) => stampOf(v)?.slice(0, 10) ?? null;

/** Whole days from `today` to `date` (both "YYYY-MM-DD"); negative when past. */
export function daysBetween(today: string, date: string) {
  const [a, b] = [today, date].map((d) => {
    const [y, m, dd] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, dd);
  });
  return Math.round((b - a) / 86_400_000);
}

const minutesOf = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// ── catalog (opac) ────────────────────────────────────────────────────────────────────────────

/** Search fields the OPAC's own selector offers (value = Solr field). */
export const SEARCH_FIELDS = {
  any: 'cc_all',
  title: 'title',
  author: 'author',
  isbn: 'isbn',
  callNumber: 'callnumber-search',
  publisher: 'publisher',
  subject: 'topic',
  series: 'congshu',
} as const;
export type SearchField = keyof typeof SEARCH_FIELDS;

/**
 * The OPAC builds the query by hand: every value is encodeURIComponent'ed once and the same
 * encoded strings go into the query string and the JSON body.
 */
export function searchRequest(field: SearchField, keyword: string, start: number, rows: number) {
  const key = SEARCH_FIELDS[field];
  const value = encodeURIComponent(field === 'isbn' ? keyword.replace(/[-\s]/g, '') : keyword.trim());
  const params: Record<string, string | number> = { [key]: value, rows, start, sort: '', 'facet.mincount': 1 };
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return { path: `/BookAPI/new_opac/query?${qs}&`, body: JSON.stringify(params) };
}

export type BookHit = {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  year: string | null;
  callNumbers: string[];
};

export function parseSearch(j: Json): { total: number; books: BookHit[] } {
  const resp = isObj(j.response) ? j.response : {};
  const books: BookHit[] = [];
  for (const d of arr(resp.docs)) {
    if (!isObj(d)) continue;
    const id = str(d.id);
    const title = plain(first(d.title), 160);
    if (!id || !title) continue;
    books.push({
      id,
      title,
      author: plain(first(d.author), 80),
      publisher: plain(first(d.publisher), 60),
      year: first(d.publishDate),
      callNumbers: uniq(arr(d['callnumber-search']).map(str).filter((s): s is string => !!s)).slice(0, 6),
    });
  }
  return { total: num(resp.numFound) ?? books.length, books };
}

export type Copy = {
  itemId: string;
  callNumber: string | null;
  library: string | null;
  /** Where it is now: a reading room, or 已借出. */
  location: string | null;
  status: 'available' | 'checked_out' | 'elsewhere';
  /** Due date when checked out ("YYYY-MM-DD"). */
  dueDate: string | null;
  /** Can be borrowed (vs. 阅览 only). */
  loanable: boolean;
  note: string | null;
};

export type Holdings = {
  id: string;
  title: string | null;
  author: string | null;
  publisher: string | null;
  year: string | null;
  isbn: string | null;
  summary: string | null;
  totalCopies: number;
  availableCopies: number;
  holdable: boolean;
  firstAvailableAt: string | null;
  copies: Copy[];
};

const CHECKED_OUT = /已借出|借出|CHECKEDOUT|CHARGED/i;

/** `/query_detail` → holdings with each copy's status. */
export function parseHoldings(id: string, j: Json, maxCopies = 30): Holdings {
  const data = isObj(j.data) ? j.data : {};
  const info = isObj(j.BookInfo) ? j.BookInfo : {};
  const titles = arr(data.TitleInfo).filter(isObj);
  const copies: Copy[] = [];
  let available = 0;
  let total = 0;
  let holdable = false;
  let firstAt: string | null = null;
  for (const t of titles) {
    const av = isObj(t.TitleAvailabilityInfo) ? t.TitleAvailabilityInfo : {};
    available += num(av.totalCopiesAvailable) ?? 0;
    holdable ||= av.holdable === true;
    firstAt ??= plain(av.locationOfFirstAvailableItem, 60);
    for (const c of arr(t.CallInfo).filter(isObj)) {
      for (const it of arr(c.ItemInfo).filter(isObj)) {
        total++;
        const itemId = str(it.itemID);
        if (!itemId) continue;
        const where = plain(it.currentLocation, 60) ?? plain(it.currentLocationID, 60);
        const out = CHECKED_OUT.test(`${str(it.currentLocationID) ?? ''} ${where ?? ''}`);
        const home = plain(it.homeLocation, 60);
        copies.push({
          itemId,
          callNumber: str(c.callNumber),
          library: plain(c.libraryID, 30),
          location: out ? home : where,
          status: out ? 'checked_out' : where && home && where !== home ? 'elsewhere' : 'available',
          dueDate: out ? dateOf(it.dueDate) : null,
          loanable: it.chargeable === true || out,
          note: plain(it.publicNote, 80) ?? (str(it.reserveCollectionID) ? `${str(it.reserveCollectionID)}${str(it.reserveCirculationRule) ? `（${str(it.reserveCirculationRule)}）` : ''}` : null),
        });
      }
    }
  }
  // On-shelf first, then by due date (soonest back first).
  const rank = (c: Copy) => (c.status === 'available' ? 0 : c.status === 'elsewhere' ? 1 : 2);
  copies.sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const t0 = titles[0] ?? {};
  return {
    id,
    title: plain(first(info.title), 160),
    author: plain(first(info.author) ?? str(t0.author), 80),
    publisher: plain(first(info.publisher), 60),
    year: first(info.publishDate),
    isbn: first(info.isbn_pure) ?? first(info.isbn) ?? first(t0.ISBN),
    summary: plain(first(info.abstract), 240),
    totalCopies: total,
    availableCopies: available,
    holdable,
    firstAvailableAt: firstAt,
    copies: copies.slice(0, maxCopies),
  };
}

// ── my account (a.lib) ────────────────────────────────────────────────────────────────────────

export type Loan = {
  itemId: string;
  title: string;
  author: string | null;
  callNumber: string | null;
  library: string | null;
  checkoutDate: string | null;
  dueDate: string | null;
  /** A recall shortens the due date (someone requested the book). */
  recallDueDate: string | null;
  daysLeft: number | null;
  overdue: boolean;
  renewalsRemaining: number | null;
  /** The portal's own rule: renewals left and not already renewed today. */
  renewable: boolean;
};

/** getMyInfobySession → { name, loans } (sorted by effective due date). */
export function parseLoans(j: Json, today: string): { name: string | null; loans: Loan[] } {
  const data = isObj(j.data) ? j.data : null;
  if (!data) throw new Error('图书馆没有返回借阅信息（登录可能已失效）');
  const patron = isObj(data.patronInfo) ? data.patronInfo : {};
  const loans: Loan[] = [];
  for (const c of arr(data.patronCheckoutInfo).filter(isObj)) {
    const itemId = str(c.itemID);
    if (!itemId) continue;
    const due = dateOf(c.dueDate);
    const recall = dateOf(c.recallDueDate);
    const effective = recall && (!due || recall < due) ? recall : due;
    const left = effective ? daysBetween(today, effective) : null;
    const remaining = num(c.renewalsRemaining);
    const lastRenewed = dateOf(c.lastRenewedDate);
    loans.push({
      itemId,
      title: plain(c.title, 160) ?? '（无题名）',
      author: plain(c.author, 80),
      callNumber: str(c.callNumber),
      library: plain(c.itemLibraryDescription, 40),
      checkoutDate: dateOf(c.checkoutDate),
      dueDate: effective,
      recallDueDate: recall,
      daysLeft: left,
      overdue: c.overdue === true || (left != null && left < 0),
      renewalsRemaining: remaining,
      renewable: (remaining ?? 0) > 0 && (!lastRenewed || lastRenewed < today),
    });
  }
  loans.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  return { name: plain(patron.displayName, 40), loans };
}

/** The portal's own translations of Symphony's renewal errors (Loan-List-Page renewItem2). */
export function renewError(message: string): string {
  if (message.includes('pending hold request') || message.includes('Item has holds')) return '该书已被他人预约，无法续借';
  if (message.includes('More than one open loan for item')) return '该书存在多条未结清借阅记录，暂不能续借';
  if (message.includes('exceed renewal limit')) return '该书已达到续借上限';
  if (message.includes('BLOCKED')) return '因有超期未还的图书或欠款，账户已被限制';
  if (message.includes('records are currently in use')) return '该书刚刚已经完成续借，请勿重复操作';
  if (message.includes('renewal would not change the due date')) return '续借不会变更到期日期，无需续借';
  return plain(message, 120) ?? '续借失败';
}

/** /circ/renewItem2 → { ok, dueDate } or { ok: false, reason }. */
export function parseRenew(j: Json): { ok: true; dueDate: string | null } | { ok: false; reason: string } {
  const d = isObj(j.data) ? j.data : j;
  const errors = arr(d.errors).filter(isObj);
  if (errors.length) return { ok: false, reason: renewError(str(errors[0].message) ?? '') };
  const fault = isObj(d.faultResponse) ? str(d.faultResponse.string) : null;
  if (fault) return { ok: false, reason: renewError(fault) };
  if (!isObj(j.data) && !str(d.dueDate)) return { ok: false, reason: plain(j.desc ?? j.msg ?? j.message, 120) ?? '续借结果未知，请刷新借阅列表确认' };
  return { ok: true, dueDate: dateOf(d.dueDate) };
}

export type Hold = {
  itemId: string | null;
  callNumber: string | null;
  title: string;
  status: string | null;
  pickupLibrary: string | null;
  /** Ready to collect at the pickup desk. */
  available: boolean;
  pickupBy: string | null;
  /** 昌平日文书 holds are cancelled through a different endpoint (taskID). */
  changping: boolean;
  taskId: string | null;
};

export function parseHolds(j: Json): Hold[] {
  const data = isObj(j.data) ? j.data : null;
  if (!data) throw new Error('图书馆没有返回预约信息（登录可能已失效）');
  const out: Hold[] = [];
  for (const h of arr(data.patronHoldInfo).filter(isObj)) {
    const inactive = str(h.holdInactiveType);
    if (inactive === 'HOLD_INACTIVE_REASON_CANCELLED' || inactive === 'HOLD_INACTIVE_REASON_FILLED') continue;
    out.push({
      itemId: str(h.itemID),
      callNumber: str(h.callNumber) ?? str(h.displayableCallNumber),
      title: plain(h.title, 160) ?? '（无题名）',
      status: plain(h.status, 30),
      pickupLibrary: plain(h.pickupLibraryDescription, 40),
      available: h.available === true,
      pickupBy: dateOf(h.expirationDate ?? h.pickupExpiryDate ?? h.fillByDate),
      changping: h.ChangpingriwenbookFlag === true,
      taskId: str(h.taskID),
    });
  }
  return out;
}

/** /circ/advisePickupAt → pickup library choices and the suggested one. */
export function parsePickup(j: Json): { options: { id: string; name: string }[]; advised: string | null } {
  const d = isObj(j.data) ? j.data : {};
  const options: { id: string; name: string }[] = [];
  for (const o of arr(d.list)) {
    if (typeof o === 'string' && o.trim()) options.push({ id: o.trim(), name: o.trim() });
    else if (isObj(o)) {
      const id = str(o.code ?? o.id ?? o.value ?? o.key ?? o.policyName);
      const name = plain(o.name ?? o.label ?? o.description ?? o.desc ?? o.policyDescription, 40) ?? id;
      if (id && name) options.push({ id, name });
    }
  }
  const adv = d.advised;
  const advised = typeof adv === 'string' ? str(adv) : isObj(adv) ? str(adv.code ?? adv.id ?? adv.value) : null;
  return { options, advised };
}

// ── hours (www.lib) ───────────────────────────────────────────────────────────────────────────

export function parseHours(j: Json): { date: string | null; open: boolean; hours: string | null; remarks: string | null } {
  const o = isObj(j.object) ? j.object : null;
  if (!o) throw new Error('图书馆网站没有返回今日开馆时间');
  return { date: dateOf(o.date), open: o.isOpen === true, hours: plain(o.openingTime, 40), remarks: plain(o.remarks, 120) };
}

// ── IC 空间 (kjyy) ─────────────────────────────────────────────────────────────────────────────

/** ic-web answers { code, message, data }; code 0 = ok. */
export function icData(j: Json, what: string): unknown {
  if (j.code !== 0) throw new Error(`${what}失败：${plain(j.message, 120) ?? `code ${String(j.code)}`}`);
  return j.data;
}

export type StudyArea = { floor: string; room: string; total: number | null; free: number | null };

/** psgSeatMenu (研修专座, public): floors → rooms with total / remaining seats. */
export function parseStudySeats(data: unknown): StudyArea[] {
  const out: StudyArea[] = [];
  for (const f of arr(data).filter(isObj)) {
    const floor = plain(f.name, 40) ?? '';
    const kids = arr(f.children).filter(isObj);
    if (!kids.length) out.push({ floor, room: floor, total: num(f.totalCount), free: num(f.remainCount) });
    for (const r of kids) out.push({ floor, room: plain(r.name, 40) ?? '', total: num(r.totalCount), free: num(r.remainCount) });
  }
  return out;
}

export type Slot = { start: string; end: string };
export type SpaceRoom = {
  devId: string;
  name: string;
  location: string | null;
  minPeople: number | null;
  maxPeople: number | null;
  open: string | null;
  minMinutes: number | null;
  maxMinutes: number | null;
  taken: Slot[];
  free: Slot[];
};

/** HH:mm of a reservation bound on `date`, clamped to that day (null when on another day). */
function onDay(v: unknown, date: string, edge: 'start' | 'end'): number | null {
  const s = stampOf(v);
  if (!s) return null;
  const d = s.slice(0, 10);
  if (d < date) return edge === 'start' ? 0 : null;
  if (d > date) return edge === 'end' ? 24 * 60 : null;
  return minutesOf(s.slice(11)) ?? (edge === 'start' ? 0 : 24 * 60);
}

/**
 * `/ic-web/reserve?sysKind=1&kindIds=…&resvDates=YYYYMMDD` → rooms with taken and free periods
 * on `date`. Free periods are the open hours minus active reservations (ended ones, bit 128,
 * free the room early), from `now` on when `date` is today, and only as long as the room's
 * minimum booking length.
 */
export function parseSpaceRooms(data: unknown, date: string, now: string): SpaceRoom[] {
  const out: SpaceRoom[] = [];
  for (const d of arr(data).filter(isObj)) {
    const devId = str(d.devId);
    if (!devId) continue;
    const rule = isObj(d.resvRule) ? d.resvRule : {};
    const openStart = str(d.openStart) ?? (isObj(rule) ? str(rule.openStart) : null);
    const openEnd = str(d.openEnd) ?? (isObj(rule) ? str(rule.openEnd) : null);
    const minMinutes = num(rule.minResvTime);
    const maxMinutes = num(rule.maxResvTime);
    const taken: [number, number][] = [];
    for (const r of arr(d.resvInfo).filter(isObj)) {
      if (((num(r.resvStatus) ?? 0) & 128) > 0) continue;
      const a = onDay(r.startTime ?? r.resvBeginTime, date, 'start');
      const b = onDay(r.endTime ?? r.resvEndTime, date, 'end');
      if (a != null && b != null && b > a) taken.push([a, b]);
    }
    taken.sort((x, y) => x[0] - y[0]);
    const free: Slot[] = [];
    const os = openStart ? minutesOf(openStart) : null;
    const oe = openEnd ? minutesOf(openEnd) : null;
    if (os != null && oe != null && oe > os) {
      let cursor = os;
      if (date === now.slice(0, 10)) {
        const n = minutesOf(now.slice(11)) ?? 0;
        // Round up to the system's 10-minute grid (sysConfig resvTimeUnit = 10).
        cursor = Math.max(cursor, Math.ceil(n / 10) * 10);
      } else if (date < now.slice(0, 10)) cursor = oe;
      const need = Math.max(minMinutes ?? 30, 10);
      for (const [a, b] of [...taken, [oe, oe] as [number, number]]) {
        const end = Math.min(a, oe);
        if (end - cursor >= need) free.push({ start: hhmm(cursor), end: hhmm(end) });
        cursor = Math.max(cursor, b);
        if (cursor >= oe) break;
      }
    }
    out.push({
      devId,
      name: plain(d.devName, 40) ?? devId,
      location: plain([str(d.labName), str(d.roomName)].filter(Boolean).join(' '), 60),
      minPeople: num(d.minUser),
      maxPeople: num(d.maxUser),
      open: openStart && openEnd ? `${openStart.slice(0, 5)}-${openEnd.slice(0, 5)}` : null,
      minMinutes,
      maxMinutes,
      taken: taken.map(([a, b]) => ({ start: hhmm(a), end: hhmm(Math.min(b, 24 * 60 - 1)) })),
      free,
    });
  }
  return out;
}

/** ic-web resvStatus bits (config.js statusOption + the status labels in the bundle). */
const STATUS_BITS: [number, string][] = [
  [16384, '被举报'],
  [8192, '待同意'],
  [2048, '暂离'],
  [512, '审核未通过'],
  [256, '待审核'],
  [128, '已结束'],
  [64, '已签到'],
  [16, '已违约'],
  [4, '已生效'],
  [2, '待生效'],
  [1024, '审核通过'],
];

export function statusText(bits: number) {
  const hit = STATUS_BITS.filter(([b]) => (bits & b) > 0).map(([, t]) => t);
  return hit.length ? hit.join('、') : '未知';
}

export type SpaceReservation = {
  uuid: string;
  kind: '研讨室' | '研修专座' | '座位' | '其他';
  place: string;
  begin: string | null;
  end: string | null;
  status: string;
  title: string | null;
  members: string[];
  /** The web page's own rule: not started (bit 4), not ended (bit 128), and I am the applicant. */
  canCancel: boolean;
};

const KIND: Record<number, SpaceReservation['kind']> = { 1: '研讨室', 32: '研修专座', 8: '座位' };

/** `/ic-web/reserve/resvInfo` → my reservations, upcoming first. Members are shown by name only. */
export function parseSpaceReservations(data: unknown, myAccNo: string | null): SpaceReservation[] {
  const out: SpaceReservation[] = [];
  for (const r of arr(data).filter(isObj)) {
    const uuid = str(r.uuid);
    if (!uuid) continue;
    const bits = num(r.resvStatus) ?? 0;
    const dev = arr(r.resvDevInfoList).filter(isObj)[0] ?? {};
    const place = plain([str(dev.labName), str(dev.roomName), str(dev.devName)].filter(Boolean).join(' '), 80) ?? '（未知位置）';
    const members = arr(r.resvMemberInfoList)
      .filter(isObj)
      .map((m) => plain(m.trueName, 20))
      .filter((s): s is string => !!s);
    const kind = KIND[num(r.classKind) ?? num(r.sysKind) ?? 0] ?? (num(r.resvProperty) === 32 ? '研修专座' : '其他');
    out.push({
      uuid,
      kind,
      place,
      begin: stampOf(r.resvBeginTime),
      end: stampOf(r.resvEndRealTime ?? r.resvEndTime),
      status: statusText(bits),
      title: plain(r.testName, 60),
      members,
      canCancel: (bits & 4) === 0 && (bits & 128) === 0 && (bits & 16) === 0 && (!myAccNo || str(r.appAccNo) === myAccNo),
    });
  }
  out.sort((a, b) => (a.begin ?? '').localeCompare(b.begin ?? ''));
  return out;
}

export type Member = { accNo: string; id: string; name: string | null; disabled: boolean };

/** `account/getMembers?key=…` → accounts; `id` is the login name (学号/工号). */
export function parseMembers(data: unknown): Member[] {
  return arr(data)
    .filter(isObj)
    .map((m) => ({
      accNo: str(m.accNo) ?? '',
      id: str(m.logonName) ?? '',
      name: plain(m.trueName, 20),
      disabled: num(m.localstatus) === 2 || num(m.status) === 2,
    }))
    .filter((m) => m.accNo && m.id);
}

/** POST /ic-web/reserve body for a 研讨室 (the research-space page's own submit). */
export function spaceReserveBody(input: { devId: string; appAccNo: string; members: string[]; begin: string; end: string; title: string; memo: string }) {
  return {
    sysKind: 1,
    appAccNo: Number(input.appAccNo) || input.appAccNo,
    memberKind: input.members.length > 1 ? 2 : 1,
    resvBeginTime: `${input.begin}:00`,
    resvEndTime: `${input.end}:00`,
    testName: input.title,
    resvKind: 2,
    resvProperty: 0,
    appUrl: '',
    resvMember: input.members.map((m) => Number(m) || m),
    resvDev: [Number(input.devId) || input.devId],
    memo: input.memo,
    captcha: '',
    addServices: [],
  };
}

// ── due-date reminders ────────────────────────────────────────────────────────────────────────

export type ReminderRecord = { todoId: string; dueDate: string; title: string };
export type ReminderPlan = {
  create: { itemId: string; title: string; dueDate: string; remindAt: number; dueAt: number }[];
  update: { itemId: string; todoId: string; title: string; dueDate: string; remindAt: number; dueAt: number }[];
  remove: { itemId: string; todoId: string }[];
  keep: string[];
};

/**
 * Diff current loans against the reminders already created (kv: itemId → record). New loans get
 * a todo, renewed ones (new due date) move theirs, returned ones lose theirs. Reminders that
 * would fire in the past fire `nowMs + 1 min` instead, unless the loan is already overdue.
 */
export function planReminders(
  loans: Pick<Loan, 'itemId' | 'title' | 'dueDate'>[],
  existing: Record<string, ReminderRecord>,
  opts: { daysBefore: number; time: string; nowMs: number },
): ReminderPlan {
  const plan: ReminderPlan = { create: [], update: [], remove: [], keep: [] };
  const [hh, mm] = opts.time.split(':').map(Number);
  const seen = new Set<string>();
  for (const l of loans) {
    if (!l.dueDate) continue;
    seen.add(l.itemId);
    const [y, m, d] = l.dueDate.split('-').map(Number);
    const dueAt = new Date(y, m - 1, d, 23, 59).getTime();
    let remindAt = new Date(y, m - 1, d - opts.daysBefore, hh, mm).getTime();
    if (remindAt <= opts.nowMs) remindAt = dueAt > opts.nowMs ? opts.nowMs + 60_000 : remindAt;
    const title = `还书：${l.title.length > 30 ? `${l.title.slice(0, 30)}…` : l.title}`;
    const rec = existing[l.itemId];
    if (!rec) {
      if (dueAt > opts.nowMs) plan.create.push({ itemId: l.itemId, title, dueDate: l.dueDate, remindAt, dueAt });
    } else if (rec.dueDate !== l.dueDate) plan.update.push({ itemId: l.itemId, todoId: rec.todoId, title, dueDate: l.dueDate, remindAt, dueAt });
    else plan.keep.push(l.itemId);
  }
  for (const [itemId, rec] of Object.entries(existing)) if (!seen.has(itemId)) plan.remove.push({ itemId, todoId: rec.todoId });
  return plan;
}
