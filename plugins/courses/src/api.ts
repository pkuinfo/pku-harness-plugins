import type { HostServices, KV } from '@pku-harness/sdk';

import { gradesPath, parseGrades } from './grades';
import {
  BB_BASE,
  param,
  parseAnnouncements,
  parseAssignment,
  parseAssignmentDetail,
  parseContent,
  parseCourses,
  parseDeadline,
  parseMenu,
  parsePlaybackParams,
  parseSubInfo,
  parseVideoIframe,
  parseVideos,
  subInfoUrl,
  type ContentItem,
  type CourseInfo,
} from './parse';
import { planSync, type SyncAssignment } from './sync';
import { buildSubmission, parseSubmitForm, parseSubmitResult, SUBMIT_PATH, type SubmitFile } from './submit';

type Services = Pick<HostServices, 'campus'>;

async function page(services: Services, url: string) {
  const res = await services.campus.request('blackboard', { url });
  if (res.status >= 400) throw new Error(`教学网返回 HTTP ${res.status}`);
  return res.body;
}

/** Run `fn` over items with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export type CrawledItem = ContentItem & { /** Folder titles from the course menu down, e.g. "课程资料 / 第二章". */ path: string };

const listUrl = (courseId: string, contentId: string) => `/webapps/blackboard/content/listContent.jsp?content_id=${contentId}&course_id=${courseId}`;

/**
 * BFS through content folders (api.rs list_all_content_recursive), 3 pages in flight, at most
 * `maxPages` listings. Roots default to the course menu's content listings (pkucli: entries whose
 * URL has content_id). `truncated` = folders were left unvisited.
 */
export async function crawl(
  services: Services,
  courseId: string,
  opts: { roots?: { id: string; path: string }[]; maxPages?: number } = {},
): Promise<{ items: CrawledItem[]; pages: number; truncated: boolean }> {
  const roots =
    opts.roots ??
    parseMenu(await page(services, coursePage(courseId)))
      .filter((e) => e.url.includes('listContent'))
      .map((e) => ({ id: param(e.url, 'content_id') ?? '', path: e.name }))
      .filter((r) => r.id);
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const queue = [...roots];
  const seen = new Set(queue.map((r) => r.id));
  const items: CrawledItem[] = [];
  let pages = 0;
  while (queue.length && pages < maxPages) {
    const batch = queue.splice(0, Math.min(3, maxPages - pages));
    pages += batch.length;
    const results = await Promise.all(batch.map((f) => page(services, listUrl(courseId, f.id)).then(parseContent, () => [] as ContentItem[])));
    results.forEach((list, i) => {
      for (const item of list) {
        const path = batch[i].path;
        items.push({ ...item, path });
        const cid = item.url ? param(item.url, 'content_id') : null;
        if (item.type === 'folder' && cid && !seen.has(cid)) {
          seen.add(cid);
          queue.push({ id: cid, path: path ? `${path} / ${item.title}` : item.title });
        }
      }
    });
  }
  return { items, pages, truncated: queue.length > 0 };
}

export type Assignment = { course: string; courseId: string; contentId: string; title: string; deadline: number | null; deadlineText: string | null; submitted: boolean; attempt: string | null };

const assignmentUrl = (courseId: string, contentId: string, view: boolean) =>
  `/webapps/assignment/uploadAssignment?${view ? 'mode=view' : 'action=newAttempt'}&content_id=${contentId}&course_id=${courseId}`;

/** Crawl the course's folders, then each assignment's page (api.rs list_assignments_for_course). */
export async function assignments(services: Services, course: CourseInfo): Promise<Assignment[]> {
  const { items } = await crawl(services, course.id);
  const found = items.filter((i) => i.type === 'assignment' && i.url && param(i.url, 'content_id')).map((i) => ({ id: param(i.url!, 'content_id')!, title: i.title }));
  return pool(found, 3, async (a) => {
    const [detail, view] = await Promise.all([
      page(services, assignmentUrl(course.id, a.id, false)).then(parseAssignment, () => null),
      page(services, assignmentUrl(course.id, a.id, true)).then(parseAssignment, () => null),
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

/** One assignment: the submit page has instructions/attachments/deadline, the review page the attempt and grade. */
export async function assignmentDetail(services: Services, courseId: string, contentId: string) {
  const [submit, view] = await Promise.all([
    page(services, assignmentUrl(courseId, contentId, false)).then(parseAssignmentDetail, () => null),
    page(services, assignmentUrl(courseId, contentId, true)).then(parseAssignmentDetail, () => null),
  ]);
  if (!submit?.title && !view?.title && !submit?.deadlineText && !view?.attempt) throw new Error('没有找到这个作业（检查 courseId / contentId，或稍后再试）');
  const deadlineText = submit?.deadlineText ?? view?.deadlineText ?? null;
  const attempt = view?.attempt ?? submit?.attempt ?? null;
  return {
    courseId,
    contentId,
    title: submit?.title || view?.title || '',
    deadline: parseDeadline(deadlineText),
    deadlineText,
    instructions: submit?.instructions || view?.instructions || '',
    attachments: submit?.attachments.length ? submit.attachments : (view?.attachments ?? []),
    status: submit?.status ?? view?.status ?? null,
    submitted: attempt != null,
    attempt,
    grade: view?.grade ?? submit?.grade ?? null,
  };
}

/** Recording list of one course, metadata only (api.rs list_videos; first 100, oldest first). */
export async function videos(services: Services, course: CourseInfo) {
  const html = await page(
    services,
    `/webapps/bb-streammedia-hqy-BBLEARN/videoList.action?sortDir=ASCENDING&numResults=100&editPaging=false&course_id=${course.id}&mode=view&startIndex=0`,
  );
  return parseVideos(html).map((v) => ({ course: course.name, courseId: course.id, ...v }));
}


/** "我的成绩" of one course (see grades.ts). */
export async function grades(services: Services, course: CourseInfo) {
  return parseGrades(await page(services, gradesPath(course.id)));
}

export type SubmitReceipt = {
  courseId: string;
  contentId: string;
  /** Blackboard shows a new attempt on the review page afterwards. */
  verified: boolean;
  attempt: string | null;
  message: string | null;
  files: string[];
  textLength: number;
  at: number;
};

/**
 * Submit files and/or text to an assignment (api.rs submit_assignment): read the newAttempt form
 * (fresh nonce), POST the multipart body, then re-read the review page to confirm the attempt.
 * Only call after the user confirmed exactly this content (see index.ts submitAssignment).
 */
export async function submitAssignment(
  services: Services,
  input: { courseId: string; contentId: string; text?: string; comment?: string; files: SubmitFile[] },
): Promise<SubmitReceipt> {
  const formUrl = assignmentUrl(input.courseId, input.contentId, false);
  const form = parseSubmitForm(await page(services, formUrl));
  if (!form.open) throw new Error(form.message ? `教学网不接受提交：${form.message}` : '这个作业现在不能提交（可能已截止，或没有剩余的提交次数）');
  if ((form.fields.course_id && form.fields.course_id !== input.courseId) || (form.fields.content_id && form.fields.content_id !== input.contentId))
    throw new Error('教学网返回的提交表单与这个作业不一致，已停止提交');
  const multipart = buildSubmission(form.fields, input);
  const res = await services.campus.request('blackboard', {
    url: SUBMIT_PATH,
    method: 'POST',
    headers: { origin: BB_BASE, referer: `${BB_BASE}${formUrl}`, accept: '*/*' },
    multipart,
  });
  const result = parseSubmitResult(res.status, res.body);
  if (!result.ok) throw new Error(`提交失败：${result.message ?? '未知原因'}`);
  const view = await page(services, assignmentUrl(input.courseId, input.contentId, true))
    .then(parseAssignmentDetail)
    .catch(() => null);
  return {
    courseId: input.courseId,
    contentId: input.contentId,
    verified: view?.attempt != null,
    attempt: view?.attempt ?? null,
    message: result.message,
    files: input.files.map((f) => f.name),
    textLength: input.text?.trim().length ?? 0,
    at: Date.now(),
  };
}

/**
 * HLS playlist of one recording (api.rs get_video_detail): play page → player iframe (its
 * redirects end on a URL with 智云 ids + auth_data) → yjapise sub-info → m3u8. The URL is signed:
 * hand it to the player/browser only, never to the model.
 */
export async function playbackUrl(services: Services, videoPageUrl: string): Promise<string> {
  if (!videoPageUrl.startsWith(`${BB_BASE}/`)) throw new Error('不是教学网的回放链接');
  const iframe = parseVideoIframe(await page(services, videoPageUrl));
  if (!iframe) throw new Error('回放页面里没有找到播放器');
  const player = await services.campus.request('blackboard', { url: iframe });
  const params = parsePlaybackParams(player.url);
  if (!params) throw new Error('回放播放器没有返回播放参数');
  const info = await services.campus.request('blackboard', { url: subInfoUrl(params), headers: { accept: 'application/json, text/plain, */*' } });
  if (info.status >= 400) throw new Error(`获取回放信息失败（HTTP ${info.status}）`);
  return parseSubInfo(info.body);
}

const SYNC_KEY = 'sync.todos';

/**
 * Apply planSync with the host's to-dos. Idempotent: the store maps each assignment to its to-do,
 * so a re-sync updates (deadline moved), completes (submitted) or keeps, and never duplicates.
 */
export async function syncDeadlines(
  services: Pick<HostServices, 'todos'>,
  kv: KV,
  list: SyncAssignment[],
  opts: { now: number; remindHours: number },
) {
  const synced = (await kv.get<Record<string, string | null>>(SYNC_KEY)) ?? {};
  // A to-do the user deleted: remember it as null so it isn't recreated.
  for (const [key, id] of Object.entries(synced)) if (id && !services.todos.get(id)) synced[key] = null;
  const steps = planSync(list, synced, (id) => services.todos.get(id), opts);
  const out = { added: [] as string[], updated: [] as string[], completed: [] as string[], kept: 0 };
  for (const step of steps) {
    if (step.kind === 'add') {
      const todo = await services.todos.add({ title: step.title, notes: step.notes, dueAt: step.dueAt, remind: step.remindAt ? { type: 'at', at: step.remindAt } : null }, 'plugin');
      synced[step.key] = todo.id;
      out.added.push(step.title);
    } else if (step.kind === 'update') {
      await services.todos.update(step.todoId, { title: step.title, notes: step.notes, dueAt: step.dueAt, remind: step.remindAt ? { type: 'at', at: step.remindAt } : null }, 'plugin');
      out.updated.push(step.title);
    } else if (step.kind === 'done') {
      await services.todos.setDone(step.todoId, true);
      out.completed.push(services.todos.get(step.todoId)?.title ?? step.key);
    } else out.kept++;
  }
  await kv.set(SYNC_KEY, synced);
  return out;
}
