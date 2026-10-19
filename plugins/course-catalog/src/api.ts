import type { HostServices, KV } from '@pku-harness/sdk';

import { parseDeanResponse, parseElectiveTable, parseSelectOptions, type CatalogCourse } from './parse';

// ── 教务部 (pkucli crates/claspider/src/dean.rs) ───────────────────────────────────────────────

const DEAN_BASE = 'https://dean.pku.edu.cn/service/web';
const DEAN_HEADERS = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  referer: `${DEAN_BASE}/courseSearch.php`,
  origin: 'https://dean.pku.edu.cn',
  'x-requested-with': 'XMLHttpRequest',
};
const DEAN_PAGE = 10;

/**
 * Public, unauthenticated request. The SDK has no host HTTP service for public hosts
 * (`services.campus.request` needs a signed-in campus service), so this uses the JS runtime's
 * `fetch` — the plugin's 'network' capability. dean.pku.edu.cn needs no cookies; its captcha is
 * only checked in the browser (dean.rs).
 */
async function publicFetch(url: string, init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> }, signal?: AbortSignal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { method: init.method ?? 'GET', headers: { ...DEAN_HEADERS, ...init.headers }, body: init.body, signal: timeout.signal });
    if (!res.ok) throw new Error(`教务部网站返回 HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (timeout.signal.aborted && !signal?.aborted) throw new Error('访问教务部网站（dean.pku.edu.cn）超时，请稍后再试');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

export type DeanQuery = { semester: string; name?: string; teacher?: string; department?: string };

/** dean.rs fetch_page: one page of 10 at `startrow`. */
async function deanPage(q: DeanQuery, startrow: number, signal?: AbortSignal) {
  const body = form({
    coursename: q.name ?? '',
    teachername: q.teacher ?? '',
    yearandseme: q.semester,
    coursetype: '0',
    yuanxi: q.department ?? '0',
    startrow: String(startrow),
  });
  const text = await publicFetch(`${DEAN_BASE}/courseSearch_do.php`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } }, signal);
  return parseDeanResponse(text);
}

/**
 * dean.rs fetch_all, bounded: pkucli walks every page; a phone fetches only enough pages for
 * `limit` rows (3 in flight).
 */
export async function deanSearch(q: DeanQuery, limit: number, signal?: AbortSignal): Promise<{ total: number; courses: CatalogCourse[] }> {
  const first = await deanPage(q, 0, signal);
  const want = Math.min(first.count, limit);
  const pages = Math.ceil(want / DEAN_PAGE);
  const rest: CatalogCourse[][] = new Array(Math.max(0, pages - 1));
  let next = 1;
  await Promise.all(
    Array.from({ length: Math.min(3, pages - 1) }, async () => {
      while (next < pages) {
        const p = next++;
        rest[p - 1] = (await deanPage(q, p * DEAN_PAGE, signal)).courses;
      }
    }),
  );
  return { total: first.count, courses: [...first.courses, ...rest.flat()].slice(0, limit) };
}

type Option = { value: string; label: string };
type Cached = { at: number; departments: Option[]; semesters: Option[] };

/** 院系 and 学期 choices from the dean search form (`yuanxi`, `yearandseme`), cached a week. */
export async function deanOptions(kv: KV, signal?: AbortSignal): Promise<Cached> {
  const cached = await kv.get<Cached>('deanOptions');
  if (cached && Date.now() - cached.at < 7 * 86_400_000 && cached.departments.length) return cached;
  try {
    const html = await publicFetch(`${DEAN_BASE}/courseSearch.php`, {}, signal);
    const out = { at: Date.now(), departments: parseSelectOptions(html, 'yuanxi'), semesters: parseSelectOptions(html, 'yearandseme') };
    if (out.departments.length) await kv.set('deanOptions', out);
    return out;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

// ── 选课网 (pkucli crates/claspider/src/elective_query.rs) ─────────────────────────────────────

const COURSE_QUERY_FORM = 'https://elective.pku.edu.cn/elective2008/edu/pku/stu/elective/controller/courseQuery/getCurriculmByForm.do';
const COURSE_QUERY_PAGE = 'https://elective.pku.edu.cn/elective2008/edu/pku/stu/elective/controller/courseQuery/queryCurriculum.jsp';
const HELP_CONTROLLER = 'https://elective.pku.edu.cn/elective2008/edu/pku/stu/elective/controller/help/HelpController.jpf';
const QUERY_CONTROLLER = 'https://elective.pku.edu.cn/elective2008/edu/pku/stu/elective/controller/courseQuery/CourseQueryController.jpf';
const ELECTIVE_PAGE = 100;

export const ELECTIVE_CATEGORIES = ['speciality', 'politics', 'english', 'gym', 'tsk_choice', 'pub_choice', 'liberal_computer', 'ldjyk', 'szxzxbx', 'education_plan_bk'] as const;
export type ElectiveCategory = (typeof ELECTIVE_CATEGORIES)[number];

/** The query form fields (elective_query.rs fetch_all / page_url), already URL-encoded keys. */
const queryFields = (category: string, dept: string) =>
  `wlw-radio_button_group_key%3A%7BactionForm.courseSettingType%7D=${category}&` +
  `%7BactionForm.courseID%7D=&` +
  `%7BactionForm.courseName%7D=&` +
  `wlw-select_key%3A%7BactionForm.deptID%7DOldValue=true&` +
  `wlw-select_key%3A%7BactionForm.deptID%7D=${dept}&` +
  `wlw-select_key%3A%7BactionForm.courseDay%7DOldValue=true&` +
  `wlw-select_key%3A%7BactionForm.courseDay%7D=&` +
  `wlw-select_key%3A%7BactionForm.courseTime%7DOldValue=true&` +
  `wlw-select_key%3A%7BactionForm.courseTime%7D=&` +
  `wlw-checkbox_key%3A%7BactionForm.queryDateFlag%7DOldValue=false&` +
  `deptIdHide=${dept}`;

async function electivePage(services: Pick<HostServices, 'campus'>, req: Parameters<HostServices['campus']['request']>[1]) {
  const res = await services.campus.request('elective', req);
  if (res.status >= 400) throw new Error(`选课网返回 HTTP ${res.status}`);
  if (res.body.includes('请重新登录')) throw new Error('选课网会话已失效，请稍后重试');
  return parseElectiveTable(res.body);
}

/**
 * elective_query.rs fetch_all: POST the form for page 1, then GET `queryCurriculum.jsp` pages
 * of 100. Bounded to `maxPages`; the name filter is applied locally, as in pkucli.
 */
export async function electiveSearch(
  services: Pick<HostServices, 'campus'>,
  q: { category: ElectiveCategory; department?: string; name?: string; maxPages: number },
): Promise<{ courses: CatalogCourse[]; pagesRead: number; totalPages: number }> {
  const dept = encodeURIComponent(q.department ?? '');
  const first = await electivePage(services, {
    url: COURSE_QUERY_FORM,
    method: 'POST',
    headers: { referer: HELP_CONTROLLER },
    body: queryFields(q.category, dept),
    contentType: 'application/x-www-form-urlencoded',
  });
  const courses = [...first.courses];
  const last = Math.min(first.totalPages, q.maxPages);
  for (let page = 1; page < last; page++) {
    const url =
      `${COURSE_QUERY_PAGE}?netui_pagesize=syllabusListGrid%3B${ELECTIVE_PAGE}&netui_row=syllabusListGrid%3B${page * ELECTIVE_PAGE}&` + queryFields(q.category, dept);
    courses.push(...(await electivePage(services, { url, headers: { referer: QUERY_CONTROLLER } })).courses);
  }
  const filtered = q.name ? courses.filter((c) => c.name.includes(q.name!)) : courses;
  return { courses: filtered, pagesRead: Math.max(1, last), totalPages: first.totalPages };
}
