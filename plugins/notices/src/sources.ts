import type { KV } from '@pku-harness/sdk';

import { getText } from './http';
import { byDateDesc, nextPageUrl, parseDeanSearch, parseList, parsePkuXml, type NoticeItem } from './parse';

/**
 * Public PKU notice sources (all verified live 2026-10-21, no login). pkucli's info-spider lists
 * WeChat official-account articles through the mp.weixin.qq.com *publisher backend*
 * (articles.rs `/cgi-bin/appmsgpublish`), which needs a QR login as an account owner, so lists
 * come from the schools' own sites; single WeChat articles are still readable (`read`).
 */
export type SourceId = 'dean' | 'grs' | 'xgb' | 'zwb' | 'news' | 'pku';

export type Source = {
  id: SourceId;
  name: string;
  /** Who publishes and what kind of items, for the model. */
  about: string;
  /** List page for 1-based `page`; undefined = reach later pages by following "下一页". */
  page: (page: number) => string | undefined;
  first: string;
  kind: 'html' | 'xml';
  /** Pages beyond the first exist. */
  paged: boolean;
};

const vsb = (base: string) => (p: number) => (p <= 1 ? `${base}index.htm` : `${base}index${p - 1}.htm`);

export const SOURCES: Record<SourceId, Source> = {
  dean: {
    id: 'dean',
    name: '教务部',
    about: '本科教务通知：选课、退课、考试、成绩单、转专业、双学位/辅修、推免、交流项目',
    first: 'https://dean.pku.edu.cn/web/notice.php?type=0&page=1',
    page: (p) => `https://dean.pku.edu.cn/web/notice.php?type=0&page=${p}`,
    kind: 'html',
    paged: true,
  },
  grs: {
    id: 'grs',
    name: '研究生院',
    about: '研究生通知：研究生选课/退课、学位论文、奖助学金、招生项目',
    first: 'https://grs.pku.edu.cn/tzgg/index.htm',
    page: vsb('https://grs.pku.edu.cn/tzgg/'),
    kind: 'html',
    paged: true,
  },
  xgb: {
    id: 'xgb',
    name: '学生工作部',
    about: '学工部最新通知：假期安排、安全提示、学生事务',
    first: 'https://xgb.pku.edu.cn/sylm/zxtz/index.htm',
    page: vsb('https://xgb.pku.edu.cn/sylm/zxtz/'),
    kind: 'html',
    paged: true,
  },
  zwb: {
    id: 'zwb',
    name: '总务部',
    about: '后勤相关通知：供暖、停水停电、校园交通（含新燕园快速公交）、假期后勤安排',
    first: 'https://zwb.pku.edu.cn/zbtb/xgtz/index.htm',
    page: vsb('https://zwb.pku.edu.cn/zbtb/xgtz/'),
    kind: 'html',
    paged: true,
  },
  news: {
    id: 'news',
    name: '北大新闻网',
    about: '学校新闻（新闻纵横）：校园要闻、会议活动、学术成果，带摘要',
    first: 'https://news.pku.edu.cn/xwzh2.htm',
    // VSB numbers news pages backwards from the last one (page 2 = xwzh2/<total-1>.htm).
    page: (p) => (p <= 1 ? 'https://news.pku.edu.cn/xwzh2.htm' : undefined),
    kind: 'html',
    paged: true,
  },
  pku: {
    id: 'pku',
    name: '学校主页通知公告',
    about: 'www.pku.edu.cn 首页的"通知公告"（学校层面声明公告，更新很少）',
    first: 'https://www.pku.edu.cn/dat/recentList.xml',
    page: (p) => (p <= 1 ? 'https://www.pku.edu.cn/dat/recentList.xml' : undefined),
    kind: 'xml',
    paged: false,
  },
};

export const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];
/** Sources merged when the caller doesn't pick one (the school homepage feed is rarely updated). */
export const DEFAULT_SOURCES: SourceId[] = ['dean', 'grs', 'xgb', 'zwb', 'news'];

/** List pages change a few times a day; 20 minutes keeps repeated questions instant. */
const TTL = 20 * 60_000;
export const MAX_PAGE = 5;

type Cached = { at: number; items: NoticeItem[]; next: string | null };

/** One list page of a source (cached in the plugin KV; an older copy is used when offline). */
export async function fetchPage(kv: KV, id: SourceId, page: number, signal?: AbortSignal, force = false): Promise<NoticeItem[]> {
  const src = SOURCES[id];
  if (page > 1 && !src.paged) return [];
  const key = `list:${id}:${page}`;
  const cached = await kv.get<Cached>(key);
  if (!force && cached && Date.now() - cached.at < TTL) return cached.items;
  try {
    let url = src.page(page);
    if (!url) {
      // Follow "下一页" from the previous page (cached, so paging forward costs one request).
      await fetchPage(kv, id, page - 1, signal);
      url = (await kv.get<Cached>(`list:${id}:${page - 1}`))?.next ?? undefined;
      if (!url) return [];
    }
    const body = await getText(url, { signal });
    const items = (src.kind === 'xml' ? parsePkuXml(body) : parseList(body, url)).sort(byDateDesc);
    if (src.kind === 'html' && !items.length) throw new Error(`${src.name}页面里没有读到通知，网站可能已改版`);
    await kv.set<Cached>(key, { at: Date.now(), items, next: src.kind === 'html' ? nextPageUrl(body, url) : null });
    return items;
  } catch (e) {
    if (cached) return cached.items;
    throw e;
  }
}

/** 教务部 site search (whole history, up to 30 hits, titles may be cut with "…"). */
export async function deanSearch(keyword: string, signal?: AbortSignal): Promise<NoticeItem[]> {
  const body = await getText('https://dean.pku.edu.cn/web/right_do.php?act=search', {
    method: 'POST',
    body: `text=${encodeURIComponent(keyword)}`,
    contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
    signal,
  });
  return parseDeanSearch(body);
}
