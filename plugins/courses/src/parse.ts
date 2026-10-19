import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Blackboard Learn page parsing, ported from pkucli crates/course/src/api.rs (selectors there
 * were checked against the live site). Pure: HTML in, data out.
 */

export const BB_BASE = 'https://course.pku.edu.cn';

export type CourseInfo = { id: string; title: string; name: string; current: boolean };
export type Announcement = { title: string; body: string; date: string; author: string };
export type Attachment = { name: string; url: string };
export type ContentItem = {
  id: string;
  /** Blackboard content id (`_123_1`): the link's content_id, else the li id without its prefix. */
  contentId: string;
  title: string;
  type: 'assignment' | 'folder' | 'document';
  url: string | null;
  description: string;
  attachments: Attachment[];
};

const text = (el: HTMLElement | null | undefined) => (el?.text ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
const abs = (href: string) => (href.startsWith('http') ? href : `${BB_BASE}${href}`);
export const param = (url: string, name: string) => {
  const v = new RegExp(`[?&]${name}=([^&#]*)`).exec(url)?.[1];
  return v == null ? null : decodeURIComponent(v);
};

/** `ul.attachments li a` → name + absolute link (api.rs parse_content_items / get_assignment). */
function attachments(root: HTMLElement): Attachment[] {
  return root
    .querySelectorAll('ul.attachments li a')
    .map((a) => ({ name: text(a), url: a.getAttribute('href') ?? '' }))
    .filter((a) => a.name && a.url)
    .map((a) => ({ name: a.name, url: abs(a.url) }));
}

/** Homepage course portlets (api.rs list_courses): `key=_123_1,` in each course link. */
export function parseCourses(html: string): CourseInfo[] {
  const dom = parse(html);
  const out: CourseInfo[] = [];
  for (const portlet of dom.querySelectorAll('div.portlet')) {
    const heading = text(portlet.querySelector('span.moduleTitle'));
    const current = heading.includes('当前') || heading.includes('Current Semester');
    for (const a of portlet.querySelectorAll('ul.courseListing li a')) {
      const id = /key=([\d_]+),/.exec(a.getAttribute('href') ?? '')?.[1];
      if (!id) continue;
      const long = text(a);
      // "00001234-0: 高等数学 (2026秋)": drop the code prefix, then the term suffix (api.rs name()).
      const title = long.includes(':') ? long.slice(long.indexOf(':') + 1).trim() : long;
      const cut = title.lastIndexOf('(');
      out.push({ id, title, name: cut > 0 ? title.slice(0, cut).trim() : title, current });
    }
  }
  return out;
}

/** Course announcement page (api.rs list_announcements). */
export function parseAnnouncements(html: string): Announcement[] {
  const dom = parse(html);
  return dom
    .querySelectorAll('#announcementList > li')
    .map((li) => {
      // The date sits in its own span; fall back to the first line after the label (api.rs).
      const stamp = li.querySelectorAll('.details span').find((el) => el.text.includes('发布时间'));
      const details = stamp?.text ?? li.querySelector('.details')?.text ?? '';
      const poster = li.querySelectorAll('.announcementInfo p').find((el) => el.text.includes('发帖者'));
      const info = poster?.text ?? li.querySelector('.announcementInfo')?.text ?? '';
      return {
        title: text(li.querySelector('h3')),
        body: text(li.querySelector('.vtbegenerated')),
        date: (details.split(/发布时间[:：]/)[1] ?? '').split('\n')[0].trim(),
        author: (info.split(/发帖者[:：]/)[1] ?? '').split('\n')[0].trim(),
      };
    })
    .filter((a) => a.title);
}

/** Course menu links (api.rs list_course_entries). */
export function parseMenu(html: string): { name: string; url: string }[] {
  return parse(html)
    .querySelectorAll('#courseMenuPalette_contents > li > a')
    .map((a) => ({ name: text(a), url: a.getAttribute('href') ?? '' }))
    .filter((e) => e.url);
}

/** listContent.jsp items (api.rs parse_content_items). */
export function parseContent(html: string): ContentItem[] {
  const dom = parse(html);
  const seen = new Set<HTMLElement>();
  const out: ContentItem[] = [];
  for (const li of dom.querySelectorAll('#content_listContainer > li, li.clearfix')) {
    if (seen.has(li)) continue;
    seen.add(li);
    const title = text(li.querySelector('h3'));
    if (!title) continue;
    const href = li.querySelector('h3 a')?.getAttribute('href') ?? null;
    const url = href ? abs(href) : null;
    const alt = li.querySelector('img')?.getAttribute('alt') ?? '';
    const type = alt === '作业' || (url != null && /uploadAssignment|assignment/.test(url)) ? 'assignment' : url?.includes('listContent') ? 'folder' : 'document';
    const id = li.getAttribute('id') ?? (url ? (param(url, 'content_id') ?? '') : '');
    out.push({
      id,
      contentId: (url ? param(url, 'content_id') : null) ?? id.replace(/^contentListItem:/, ''),
      title,
      type,
      url,
      description: text(li.querySelector('div.vtbegenerated') ?? li.querySelector('div.details')),
      attachments: attachments(li),
    });
  }
  return out;
}

/** Assignment page: due date text and the current attempt label (api.rs get_assignment / get_assignment_attempt). */
export function parseAssignment(html: string): { deadlineText: string | null; attempt: string | null } {
  const dom = parse(html);
  const d = text(dom.querySelector('.itemdates'));
  const a = text(dom.querySelector('h3#currentAttempt_label'));
  return { deadlineText: d || null, attempt: a ? a.split(/\s+/).join(' ') : null };
}

/** "2026年10月20日 星期二 下午11:59" → epoch ms in local time (api.rs parse_deadline). */
export function parseDeadline(raw: string | null): number | null {
  if (!raw) return null;
  const m = /(\d{4})年(\d{1,2})月(\d{1,2})日 星期. (上午|下午)(\d{1,2}):(\d{1,2})/.exec(raw);
  if (!m) return null;
  let hour = Number(m[5]);
  if (m[4] === '下午' && hour < 12) hour += 12;
  if (m[4] === '上午' && hour === 12) hour = 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, Number(m[6])).getTime();
}

export type AssignmentDetail = {
  title: string;
  deadlineText: string | null;
  instructions: string;
  attachments: Attachment[];
  status: string | null;
  attempt: string | null;
  grade: string | null;
};

/**
 * Full assignment page (api.rs get_assignment on `action=newAttempt`, get_assignment_attempt on
 * `mode=view`). Works on either page; the caller merges both. The grade is not parsed by pkucli:
 * best effort from Blackboard's review page ids (`currentAttempt_grade`, `aggregateGrade`).
 */
export function parseAssignmentDetail(html: string): AssignmentDetail {
  const dom = parse(html);
  const { deadlineText, attempt } = parseAssignment(html);
  const gradeEl = dom.querySelector('#currentAttempt_grade') ?? dom.querySelector('#aggregateGrade');
  const grade = (gradeEl?.getAttribute('value') ?? text(gradeEl)).trim();
  const possible = text(dom.querySelector('#currentAttempt_pointsPossible') ?? dom.querySelector('#aggregateGrade_pointsPossible'));
  // Grade not entered yet shows as "-" (or an empty input).
  const graded = grade && grade !== '-' ? `${grade}${possible ? ` ${possible}` : ''}` : null;
  return {
    title: text(dom.querySelector('span.title') ?? dom.querySelector('#pageTitleText')),
    deadlineText,
    instructions: text(dom.querySelector('div.vtbegenerated')),
    attachments: attachments(dom),
    status: text(dom.querySelector('.status')) || null,
    attempt,
    grade: graded,
  };
}

export type VideoInfo = { title: string; time: string; teacher: string; url: string };

const VIDEO_BASE = `${BB_BASE}/webapps/bb-streammedia-hqy-BBLEARN/`;
const resolve = (href: string, base: string) =>
  /^https?:\/\//i.test(href) ? href : href.startsWith('/') ? `${BB_BASE}${href}` : base + href.replace(/^\.\//, '');

/**
 * Course recording list, `videoList.action` (api.rs list_videos): one row per recording; the
 * first cell is the title, then `span.table-data-cell-value` cells = time, teacher, link.
 */
export function parseVideos(html: string): VideoInfo[] {
  return parse(html)
    .querySelectorAll('tbody#listContainer_databody > tr')
    .map((tr) => {
      const cells = tr.querySelectorAll('span.table-data-cell-value');
      const href = cells[2]?.querySelector('a')?.getAttribute('href') ?? '';
      return {
        title: text(tr.children[0]),
        time: text(cells[0]),
        teacher: text(cells[1]),
        url: href ? resolve(href, VIDEO_BASE) : '',
      };
    })
    .filter((v) => v.title);
}

/**
 * Tool results go to the model provider: strip credential-like query parameters (Blackboard
 * play links carry a session token) so no session secret leaves the device. The link still
 * identifies the page; opening it needs the user's own 教学网 login.
 */
export function redactUrl(url: string) {
  return url.replace(/([?&])(token|access_token|ticket|jsessionid|sid|session|sign|signature)=[^&#]*(&)?/gi, (_m, sep: string, _k: string, amp?: string) => (amp ? sep : '')).replace(/[?&]$/, '');
}
