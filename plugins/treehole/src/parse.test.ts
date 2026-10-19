/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { parseComment, parseHole, parseHoleDetail, parseHoleList, parseHoles, postedPid } from './parse';

// Shapes from pkucli docs/treehole-api.md "Data Models" and api.rs parse_* functions.
const hole = {
  pid: 8132392,
  text: '有没有人知道理教的自习室几点关门',
  type: 'text',
  timestamp: 1775469368,
  hidden: 0,
  reply: 29,
  likenum: 5,
  anonymous: 1,
  is_top: 0,
  tags_ids: '',
  media_ids: '101,102',
  reward_cost: 0,
  is_follow: 1,
  tread_num: 2,
  tags_info: [{ tag_name: '求助' }, { id: 3 }],
  attention_info: [],
};
const comment = {
  cid: 37426925,
  pid: 8132392,
  text: '十一点',
  timestamp: 1775469860,
  anonymous: 1,
  comment_id: null,
  name_tag: 'Alice',
  media_ids: '',
  is_lz: 0,
  quote: { cid: 37426971, text: 'quoted comment', name_tag: 'Bob' },
};

describe('parseHole', () => {
  test('maps fields, seconds → ms, media and tags', () => {
    expect(parseHole(hole)).toEqual({
      pid: 8132392,
      text: '有没有人知道理教的自习室几点关门',
      time: 1775469368000,
      replies: 29,
      likes: 5,
      treads: 2,
      followed: true,
      pinned: false,
      reward: 0,
      tags: ['求助'],
      images: 2,
    });
  });

  test('missing fields default like serde(default)', () => {
    const h = parseHole({ pid: 1 });
    expect(h).toMatchObject({ pid: 1, text: '', time: 0, replies: 0, followed: false, tags: [], images: 0 });
  });

  test('attention_info as object does not break it', () => {
    expect(parseHole({ ...hole, attention_info: { a: 1 } }).pid).toBe(8132392);
  });
});

describe('parseComment', () => {
  test('quote and OP flag', () => {
    expect(parseComment(comment)).toEqual({
      cid: 37426925,
      name: 'Alice',
      isOp: false,
      text: '十一点',
      time: 1775469860000,
      quote: { name: 'Bob', text: 'quoted comment' },
      images: 0,
    });
    const op = parseComment({ ...comment, is_lz: 1, quote: null, name_tag: '洞主' });
    expect(op.isOp).toBe(true);
    expect(op.quote).toBeNull();
  });

  test('a quote without name_tag is ignored (display.rs)', () => {
    expect(parseComment({ ...comment, quote: { text: 'x' } }).quote).toBeNull();
    expect(parseComment({ ...comment, quote: [] }).quote).toBeNull();
  });
});

describe('parseHoleList (hole/list_comments)', () => {
  test('comment_list previews', () => {
    const list = parseHoleList({ list: [{ ...hole, comment_list: [comment, { ...comment, cid: 2 }] }, { pid: 2, text: 'b', timestamp: 1 }], total: 2 });
    expect(list).toHaveLength(2);
    expect(list[0].comments.map((c) => c.cid)).toEqual([37426925, 2]);
    expect(list[1].comments).toEqual([]);
  });

  test('accepts the "comments" alias', () => {
    expect(parseHoleList({ list: [{ ...hole, comments: [comment] }] })[0].comments).toHaveLength(1);
  });

  test('missing list throws', () => {
    expect(() => parseHoleList({})).toThrow();
    expect(() => parseHoleList(null)).toThrow();
  });
});

describe('parseHoles (hole/list, hole/my_list)', () => {
  test('plain holes', () => {
    expect(parseHoles({ list: [hole] }).map((h) => h.pid)).toEqual([8132392]);
    expect(() => parseHoles({ data: [] })).toThrow();
  });
});

describe('parseHoleDetail (hole/one)', () => {
  test('hole, comments and total', () => {
    const d = parseHoleDetail({ hole, list: [comment], total: 29 });
    expect(d.hole.pid).toBe(8132392);
    expect(d.comments[0].quote?.name).toBe('Bob');
    expect(d.total).toBe(29);
  });

  test('no total, no list', () => {
    const d = parseHoleDetail({ hole });
    expect(d.total).toBeNull();
    expect(d.comments).toEqual([]);
  });

  test('missing hole throws', () => {
    expect(() => parseHoleDetail({ list: [] })).toThrow();
  });
});

describe('postedPid', () => {
  test('hole/post data', () => {
    expect(postedPid({ pid: 8140000 })).toBe(8140000);
    expect(postedPid(null)).toBeNull();
  });
});
