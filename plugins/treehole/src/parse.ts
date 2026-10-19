/**
 * Parsing for the treehole `/chapi/api/v3/hole/*` JSON (pkucli crates/treehole/src/api.rs
 * `parse_hole_list_items`, `parse_hole_with_comments`, `parse_hole`, `parse_comment`). Like
 * pkucli, fields are read one by one with defaults instead of trusting the shape: the server
 * mixes arrays and objects in some fields (`attention_info`), and missing numbers become 0.
 */

type Json = Record<string, unknown>;

export type Quote = { name: string; text: string };

export type Comment = {
  cid: number;
  /** Anonymous name the server gives the commenter in this hole ("Alice", "洞主"). */
  name: string;
  /** Written by the hole's author (洞主). */
  isOp: boolean;
  text: string;
  /** ms epoch */
  time: number;
  /** The comment this one replies to, when it quotes one. */
  quote: Quote | null;
  images: number;
};

export type Hole = {
  pid: number;
  text: string;
  /** ms epoch */
  time: number;
  replies: number;
  likes: number;
  treads: number;
  followed: boolean;
  pinned: boolean;
  /** 悬赏 (leaf reward) amount, 0 when none. */
  reward: number;
  tags: string[];
  images: number;
};

export type HoleWithPreview = Hole & { comments: Comment[] };
export type HoleDetail = { hole: Hole; comments: Comment[]; total: number | null };

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
/** api.rs val_i64: numbers only (numeric strings are tolerated here), else 0. */
const num = (v: Json, k: string) => {
  const x = v[k];
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && /^-?\d+$/.test(x)) return Number(x);
  return 0;
};
const str = (v: Json, k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
/** display.rs media_badge: `media_ids` is a comma list. */
const mediaCount = (ids: string) => ids.split(',').filter((s) => s.trim()).length;
/** Treehole timestamps are seconds. */
const ms = (s: number) => s * 1000;

function tags(v: Json): string[] {
  const t = v.tags_info;
  return Array.isArray(t) ? t.map((x) => str(obj(x), 'tag_name')).filter(Boolean) : [];
}

/** display.rs: a quote shows only when it is an object with both `text` and `name_tag`. */
function quote(v: unknown): Quote | null {
  const q = obj(v);
  return typeof q.text === 'string' && typeof q.name_tag === 'string' ? { name: q.name_tag, text: q.text } : null;
}

export function parseComment(raw: unknown): Comment {
  const c = obj(raw);
  return {
    cid: num(c, 'cid'),
    name: str(c, 'name_tag'),
    isOp: num(c, 'is_lz') === 1,
    text: str(c, 'text'),
    time: ms(num(c, 'timestamp')),
    quote: quote(c.quote),
    images: mediaCount(str(c, 'media_ids')),
  };
}

const comments = (v: Json, key: string): Comment[] => (Array.isArray(v[key]) ? (v[key] as unknown[]).map(parseComment) : []);

export function parseHole(raw: unknown): Hole {
  const v = obj(raw);
  return {
    pid: num(v, 'pid'),
    text: str(v, 'text'),
    time: ms(num(v, 'timestamp')),
    replies: num(v, 'reply'),
    likes: num(v, 'likenum'),
    treads: num(v, 'tread_num'),
    followed: num(v, 'is_follow') === 1,
    pinned: num(v, 'is_top') === 1,
    reward: num(v, 'reward_cost'),
    tags: tags(v),
    images: mediaCount(str(v, 'media_ids')),
  };
}

/**
 * `hole/list_comments` data: `{ list: [hole + comment_list] }` (api.rs HoleListItem also accepts
 * the `comments` alias). Throws when `list` is missing, like pkucli.
 */
export function parseHoleList(data: unknown): HoleWithPreview[] {
  const d = obj(data);
  if (!Array.isArray(d.list)) throw new Error('树洞返回的数据缺少帖子列表');
  return d.list.map((raw) => {
    const v = obj(raw);
    return { ...parseHole(v), comments: comments(v, Array.isArray(v.comment_list) ? 'comment_list' : 'comments') };
  });
}

/** `hole/list` (search) and `hole/my_list` data: `{ list: [hole] }` (api.rs ListData<Hole>). */
export function parseHoles(data: unknown): Hole[] {
  const d = obj(data);
  if (!Array.isArray(d.list)) throw new Error('树洞返回的数据缺少帖子列表');
  return d.list.map(parseHole);
}

/** `hole/one` data: `{ hole, list: [comment], total }`. */
export function parseHoleDetail(data: unknown): HoleDetail {
  const d = obj(data);
  if (!d.hole || typeof d.hole !== 'object') throw new Error('树洞返回的数据缺少帖子内容');
  return { hole: parseHole(d.hole), comments: comments(d, 'list'), total: typeof d.total === 'number' ? d.total : null };
}

/** `hole/post` data: `{ pid }` (commands.rs cmd_post). */
export function postedPid(data: unknown): number | null {
  const pid = num(obj(data), 'pid');
  return pid || null;
}
