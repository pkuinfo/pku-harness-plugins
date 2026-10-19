import type { HostServices } from '@pku-harness/sdk';

import { parseElected, parseNotice, parseQuota, parseResults, parseSupplements, parseTotalPages, type CourseRow } from './parse';

/**
 * 选课网 requests (pkucli crates/elective/src/api.rs), read-only. The harness `elective` adapter
 * signs in and follows redirects; `x-elective-program` picks 主修 / 辅双 on dual-degree accounts.
 */

type Services = Pick<HostServices, 'campus'>;
export type Program = 'major' | 'minor';

const ROOT = 'https://elective.pku.edu.cn/elective2008/edu/pku/stu/elective/controller';
const SHOW_RESULTS = `${ROOT}/electiveWork/showResults.do`;
const HELP_CONTROLLER = `${ROOT}/help/HelpController.jpf`;
const SUPPLY_CANCEL = `${ROOT}/supplement/SupplyCancel.do`;
const SUPPLEMENT = `${ROOT}/supplement/supplement.jsp`;
/** Courses per supplement page (api.rs get_supplements: netui_row=electableListGrid;page*20). */
const PAGE_SIZE = 20;

async function page(services: Services, url: string, referer: string, program?: Program) {
  const headers: Record<string, string> = { referer, 'cache-control': 'max-age=0' };
  if (program) headers['x-elective-program'] = program;
  const res = await services.campus.request('elective', { url, headers });
  if (res.status >= 400) throw new Error(`选课网返回 HTTP ${res.status}`);
  const shown = res.headers['x-elective-program'];
  return { body: res.body, program: (shown === 'major' || shown === 'minor' ? shown : 'single') as Program | 'single' };
}

/** The student id (`xh` on the supplement pages, api.rs uses the login username). */
function studentId(services: Services) {
  const id = services.campus.status().username;
  if (!id) throw new Error('还没有登录校园账号（设置 → 校园账号）');
  return encodeURIComponent(id);
}

/** A page without the expected table: usually "not the election period" or a site notice. */
function missing(html: string, what: string): never {
  const notice = parseNotice(html);
  throw new Error(`选课网没有返回${what}${notice ? `，页面提示：「${notice}」` : ''}（可能当前不在选课阶段）`);
}

const base = (c: CourseRow) => ({
  code: c.code || undefined,
  name: c.name,
  teacher: c.teacher,
  classId: c.classId,
  credit: c.credit,
  category: c.category,
  department: c.department,
});

const withQuota = (c: CourseRow) => {
  const q = parseQuota(c.status);
  return { ...base(c), info: c.info || undefined, quota: c.status, ...(q ? { limit: q.limit, elected: q.elected, waitlist: q.waitlist ?? undefined, remaining: q.remaining, full: q.full } : {}) };
};

/** 选课结果 (api.rs get_results). */
export async function results(services: Services, program?: Program) {
  const res = await page(services, SHOW_RESULTS, HELP_CONTROLLER, program);
  const rows = parseResults(res.body) ?? missing(res.body, '选课结果');
  return { program: res.program, courses: rows.map((c) => ({ ...base(c), hours: c.hours, classroom: c.info, result: c.status })) };
}

/** 补退选 entry page (api.rs get_supply_cancel): total pages + courses already elected. */
export async function supplyCancel(services: Services, program?: Program) {
  const res = await page(services, `${SUPPLY_CANCEL}?xh=${studentId(services)}`, HELP_CONTROLLER, program);
  return { program: res.program, totalPages: parseTotalPages(res.body), elected: parseElected(res.body).map((c) => ({ ...withQuota(c), grade: c.info || undefined, info: undefined })) };
}

/** One 补退选 list page, 0-based (api.rs get_supplements). */
export async function supplementPage(services: Services, index: number, program?: Program) {
  const res = await page(services, `${SUPPLEMENT}?xh=${studentId(services)}&netui_row=electableListGrid;${index * PAGE_SIZE}`, SUPPLY_CANCEL, program);
  const rows = parseSupplements(res.body) ?? missing(res.body, '补退选课程列表');
  return rows.map((c) => ({ ...withQuota(c), page: index + 1 }));
}

/** Bounded crawl for search: pkucli get_all_supplements walks every page; a phone stops here. */
const MAX_SEARCH_PAGES = 25;

/** Search the 补退选 list by course name / teacher / course code (sequential, like pkucli). */
export async function search(services: Services, query: string, opts: { onlyAvailable?: boolean; program?: Program } = {}) {
  const { totalPages, program } = await supplyCancel(services, opts.program);
  const q = query.trim().toLowerCase();
  const pages = Math.min(totalPages, MAX_SEARCH_PAGES);
  const matches: Awaited<ReturnType<typeof supplementPage>> = [];
  for (let i = 0; i < pages; i++) {
    for (const c of await supplementPage(services, i, opts.program)) {
      const hay = `${c.name} ${c.teacher} ${c.code ?? ''} ${c.department}`.toLowerCase();
      if (hay.includes(q) && (!opts.onlyAvailable || c.full !== true)) matches.push(c);
    }
  }
  return { program, query, searchedPages: pages, totalPages, truncated: totalPages > pages, matches };
}
