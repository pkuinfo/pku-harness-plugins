import type { HostServices } from '@pku-harness/sdk';

import { param, parseAnnouncements, parseAssignment, parseContent, parseCourses, parseDeadline, parseMenu, type CourseInfo } from './parse';

type Services = Pick<HostServices, 'campus'>;

async function page(services: Services, url: string) {
  const res = await services.campus.request('blackboard', { url });
  if (res.status >= 400) throw new Error(`教学网返回 HTTP ${res.status}`);
  return res.body;
}

/** Run `fn` over items with at most `n` in flight. */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function listCourses(services: Services, all = false): Promise<CourseInfo[]> {
  const courses = parseCourses(await page(services, '/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1'));
  return all ? courses : courses.filter((c) => c.current);
}

const coursePage = (id: string) => `/webapps/blackboard/execute/announcement?method=search&context=course_entry&course_id=${id}&handle=announcements_entry&mode=view`;

export async function announcements(services: Services, courses: CourseInfo[]) {
  const lists = await pool(courses, 3, async (c) =>
    parseAnnouncements(await page(services, coursePage(c.id)))
      .slice(0, 10)
      .map((a) => ({ course: c.name, ...a })),
  );
  return lists.flat();
}

/** Bounds for one course's content crawl (pkucli walks everything; a phone shouldn't). */
const MAX_PAGES = 25;

export type Assignment = { course: string; courseId: string; contentId: string; title: string; deadline: number | null; deadlineText: string | null; submitted: boolean; attempt: string | null };

/** BFS from the course menu through folders (api.rs list_all_content_recursive), then each assignment's page. */
export async function assignments(services: Services, course: CourseInfo): Promise<Assignment[]> {
  const menu = parseMenu(await page(services, coursePage(course.id)));
  // Only content listings are worth crawling (pkucli: entries whose URL has content_id).
  const queue = menu
    .filter((e) => e.url.includes('listContent'))
    .map((e) => param(e.url, 'content_id'))
    .filter((x): x is string => !!x);
  const seen = new Set(queue);
  const found: { id: string; title: string }[] = [];
  let pages = 0;
  while (queue.length && pages < MAX_PAGES) {
    const batch = queue.splice(0, 3);
    pages += batch.length;
    const results = await Promise.all(
      batch.map((cid) => page(services, `/webapps/blackboard/content/listContent.jsp?content_id=${cid}&course_id=${course.id}`).then(parseContent, () => [])),
    );
    for (const item of results.flat()) {
      const cid = item.url ? param(item.url, 'content_id') : null;
      if (item.type === 'folder' && cid && !seen.has(cid)) {
        seen.add(cid);
        queue.push(cid);
      } else if (item.type === 'assignment' && cid) found.push({ id: cid, title: item.title });
    }
  }
  return pool(found, 3, async (a) => {
    const [detail, view] = await Promise.all([
      page(services, `/webapps/assignment/uploadAssignment?action=newAttempt&content_id=${a.id}&course_id=${course.id}`).then(parseAssignment, () => null),
      page(services, `/webapps/assignment/uploadAssignment?mode=view&content_id=${a.id}&course_id=${course.id}`).then(parseAssignment, () => null),
    ]);
    const attempt = view?.attempt ?? detail?.attempt ?? null;
    return {
      course: course.name,
      courseId: course.id,
      contentId: a.id,
      title: a.title,
      deadline: parseDeadline(detail?.deadlineText ?? null),
      deadlineText: detail?.deadlineText ?? null,
      submitted: attempt != null,
      attempt,
    };
  });
}

