import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Pure parsers for the public notice sites (fixtures in ./fixtures, captured 2026-10-21):
 * - list pages: 北大新闻网 (news.pku.edu.cn, VSB CMS), 教务部 (dean.pku.edu.cn notice.php),
 *   研究生院 / 学工部 / 总务部 (VSB-style `<li><a>标题</a><span>[日期]</span></li>`),
 *   学校主页通知公告 (www.pku.edu.cn/dat/recentList.xml, the feed the homepage loads)
 * - article pages on those sites and mp.weixin.qq.com (pkucli crates/info-spider/src/scrape.rs:
 *   keep only the `#js_content` body, drop script/style).
 * Everything here is third-party text: data, never instructions.
 */

export type NoticeItem = { title: string; url: string; date: string | null; summary?: string };

const DATE = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/;
const pad = (s: string) => s.padStart(2, '0');

/** First date in the text as "YYYY-MM-DD" (2026/10/20, 2026-10-20, 2026年10月20日). */
export function findDate(text: string): string | null {
  const m = DATE.exec(text);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
}

/** Resolve `href` against the page URL (handles "../x", "x.htm", "/x", absolute). */
export function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href.replace(/&amp;/g, '&'), base).toString();
  } catch {
    return href;
  }
}

const squash = (s: string) => s.replace(/[\s ​　]+/g, ' ').trim();

/** A clean element tree: comments and script/style/noscript removed. */
function tree(html: string): HTMLElement {
  const root = parse(html, { comment: false });
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  return root;
}

const DETAIL = /\.(s?html?|php|jsp|aspx?)(\?|#|$)/i;

/**
 * Generic list page: every `<li>` (or 教务部 `.notice_box`) that links to a detail page and
 * carries a date is an item. Navigation `<li>`s have no date, so they drop out on their own.
 * Title preference: `h3.title` (VSB news cards), the link's `title` attribute, then the link
 * text without the date. 北大新闻网 cards also carry a `p.text` summary.
 */
export function parseList(html: string, pageUrl: string, max = 60): NoticeItem[] {
  const root = tree(html);
  const out: NoticeItem[] = [];
  const seen = new Set<string>();
  for (const block of root.querySelectorAll('li, .notice_box')) {
    if (block.querySelector('li')) continue; // a menu wrapping other items
    const a = block.querySelectorAll('a').find((x) => {
      const href = x.getAttribute('href') ?? '';
      return href && !href.startsWith('#') && !href.startsWith('javascript') && DETAIL.test(href) && !/(^|\/)index\d*\.htm/.test(href);
    });
    if (!a) continue;
    const date = findDate(block.querySelector('.time, .s-dt, span, .date')?.text ?? '') ?? findDate(block.text);
    if (!date) continue;
    const titleEl = block.querySelector('h3.title, .title');
    const raw = titleEl?.text || a.getAttribute('title') || a.text;
    const title = squash(raw.replace(/\[\s*\d{4}-\d{2}-\d{2}\s*\]/g, '').replace(DATE, '')).replace(/^\[[^\]]{1,6}\]\s*/, '');
    if (!title || title.length < 4) continue;
    const url = resolveUrl(a.getAttribute('href')!, pageUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const summary = squash(block.querySelector('p.text')?.text ?? '');
    out.push({ title, url, date, ...(summary ? { summary: clip(summary, 160) } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

/** www.pku.edu.cn/dat/recentList.xml: `<Notice><ID/><PubDeptName/><Title/><PubDate/></Notice>` (homeJson.js). */
export function parsePkuXml(xml: string): NoticeItem[] {
  const out: NoticeItem[] = [];
  for (const m of xml.matchAll(/<Notice>([\s\S]*?)<\/Notice>/g)) {
    const tag = (t: string) => squash(decode(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(m[1])?.[1] ?? ''));
    const id = tag('ID');
    const title = tag('Title');
    if (!id || !title) continue;
    const dept = tag('PubDeptName');
    out.push({ title, url: `https://www.pku.edu.cn/notice/detail.html?aid=${id}`, date: findDate(tag('PubDate')), ...(dept ? { summary: dept } : {}) });
  }
  return out;
}

/**
 * 教务部 site search (dean.pku.edu.cn/web/right_do.php?act=search, POST text=…, what the page's
 * search box calls): `{status, msg}` where msg is HTML with up to 30 links. Titles end in "..."
 * when long and carry a "[公告]" prefix; there are no dates.
 */
export function parseDeanSearch(json: string): NoticeItem[] {
  let msg = '';
  try {
    const r = JSON.parse(json) as { status?: boolean; msg?: string };
    if (!r.status) return [];
    msg = r.msg ?? '';
  } catch {
    return [];
  }
  const root = parse(msg);
  return root
    .querySelectorAll('a')
    .map((a) => ({ title: squash(a.text.replace(/^\[[^\]]{1,6}\]/, '')), url: resolveUrl(a.getAttribute('href') ?? '', 'https://dean.pku.edu.cn/web/'), date: null }))
    .filter((x) => x.title && /notice_details\.php\?id=\d+/.test(x.url));
}

/** "下一页" / "下页" link on a list page, absolute. */
export function nextPageUrl(html: string, pageUrl: string): string | null {
  const root = parse(html);
  const a = root.querySelectorAll('a').find((x) => /^\s*下一?页\s*$/.test(x.text) && /\.(htm|php)/.test(x.getAttribute('href') ?? ''));
  return a ? resolveUrl(a.getAttribute('href')!, pageUrl) : null;
}

// ── Articles ──

export type Article = {
  title: string;
  date: string | null;
  /** Publishing department or WeChat account, when the page says. */
  source: string | null;
  text: string;
  /** Attached files (pdf, doc, xls…) linked from the body. */
  attachments: { name: string; url: string }[];
  images: number;
};

/** Content containers in priority order (most specific first). */
const CONTAINERS = ['#js_content', '.v_news_content', '.newsinfo_box', '.gp-article1', '.article', '.wp_articlecontent', '#vsb_content', '.content', 'article', 'main'];

const FILE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|wps|txt|csv)(\?|$)/i;

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

const BLOCK = new Set(['p', 'div', 'section', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol', 'blockquote', 'article', 'header', 'footer']);

/** Readable text: block elements become lines, table cells are joined with " | ". */
export function htmlToText(el: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: HTMLElement) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        parts.push(decode(child.rawText).replace(/[\s ​]+/g, ' '));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const c = child as HTMLElement;
      const tag = c.rawTagName?.toLowerCase() ?? '';
      if (tag === 'br') {
        parts.push('\n');
        continue;
      }
      if (tag === 'img') continue;
      const block = BLOCK.has(tag);
      if (block) parts.push('\n');
      walk(c);
      if (tag === 'td' || tag === 'th') parts.push(' | ');
      if (block) parts.push('\n');
    }
  };
  walk(el);
  return parts
    .join('')
    .split('\n')
    .map((l) => l.replace(/\s*\|\s*$/, '').replace(/[ \t　]+/g, ' ').trim())
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function meta(root: HTMLElement, prop: string): string {
  return squash(root.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') ?? '');
}

/** Extract one article (title, date, source, body text) from a notice page or WeChat article. */
export function parseArticle(html: string, pageUrl: string): Article {
  const wechat = /mp\.weixin\.qq\.com/.test(pageUrl);
  // WeChat's publish time is a script variable (`var ct = "1788426855"`), unix seconds.
  const ct = /var ct\s*=\s*"(\d{9,11})"/.exec(html)?.[1];
  const root = tree(html);
  let body: HTMLElement | null = null;
  for (const sel of CONTAINERS) {
    const found = root.querySelectorAll(sel).sort((a, b) => b.text.length - a.text.length)[0];
    if (found && squash(found.text).length > 10) {
      body = found;
      break;
    }
  }
  body ??= root.querySelector('body') ?? root;

  const titleEl = root.querySelector('#activity-name, .rich_media_title, .news-header h3, .newsinfo_box h1, .articleTitle h2, .article .title, .gp-articleTitle, h1');
  const title = squash(meta(root, 'og:title') || titleEl?.text || root.querySelector('title')?.text || '').replace(/_北京大学.*$/, '');

  const head = squash(root.querySelector('.news-header .info, .articleAuthor, .gp-articleAuthor, .newsinfo_box > span, .introTit, .info')?.text ?? '');
  let date = ct ? beijingDate(Number(ct) * 1000) : findDate(/发布(?:时间|日期)[：:]\s*([^\s]+)/.exec(head)?.[1] ?? head) ?? findDate(squash(body.text).slice(-200));

  let source: string | null = null;
  if (wechat) source = squash(root.querySelector('#js_name')?.text ?? '') || null;
  else source = /(?:信息)?来源[：:]\s*([^\s|]{2,30})/.exec(head)?.[1] ?? null;

  // A list item title inside the body (学工部 / 总务部 put the title in `p.title`) is not body text.
  for (const t of body.querySelectorAll('p.title, #title')) t.remove();

  const attachments: Article['attachments'] = [];
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    if (!FILE.test(href)) continue;
    const url = resolveUrl(href, pageUrl);
    if (attachments.some((x) => x.url === url)) continue;
    attachments.push({ name: squash(a.text) || decodeURIComponent(url.split('/').pop() ?? ''), url });
  }
  for (const li of body.querySelectorAll('li')) if (li.querySelector('a') && FILE.test(li.querySelector('a')!.getAttribute('href') ?? '')) li.remove();

  const images = body.querySelectorAll('img').length;
  const lines = htmlToText(body)
    .split('\n')
    .filter((l) => !/^(转载本网文章请注明出处|分享到：?|返回|【 字体：.*】|预览时标签不可点)$/.test(l));
  // Pages that repeat the title and date at the top of the body (教务部): drop those lines.
  while (lines.length && (!lines[0] || squash(lines[0]) === title || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(lines[0].trim()))) lines.shift();
  const text = lines.join('\n').trim();
  if (!date) date = null;
  return { title, date, source, text, attachments: attachments.slice(0, 20), images };
}

/** Beijing calendar date of a timestamp, independent of the device time zone. */
export function beijingDate(ms: number): string {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10);
}

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Notice detail hosts this plugin will read: PKU sites and WeChat official-account articles. */
export function allowedArticleUrl(url: string): boolean {
  const m = /^https?:\/\/([^/:?#]+)(?::\d+)?(\/|$|\?)/i.exec(url.trim());
  if (!m) return false;
  const host = m[1].toLowerCase();
  return host === 'pku.edu.cn' || host.endsWith('.pku.edu.cn') || host === 'mp.weixin.qq.com';
}

/** Case-insensitive keyword match on title + summary; all space-separated words must match. */
export function matches(item: NoticeItem, keyword: string): boolean {
  const hay = `${item.title} ${item.summary ?? ''}`.toLowerCase();
  return keyword
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Newest first; undated items last. */
export const byDateDesc = (a: NoticeItem, b: NoticeItem) => (b.date ?? '').localeCompare(a.date ?? '');
