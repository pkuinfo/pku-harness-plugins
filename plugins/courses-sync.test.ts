/**
 * The courses document's host-ability side, which recorded tests (tests/*.yaml) can't supply:
 * syncDeadlines against a fake to-do store (idempotent re-syncs, moved deadlines, submitted
 * assignments, deleted to-dos, the TS-era kv map) and play opening the browser without the signed
 * URL ever reaching the result. Blackboard responses come from tests/assignments.yaml.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

import { loadDocument } from '../packages/sdk/src';
import { runTool } from '../packages/sdk/src/lang/run';
import { replayEnv, type Recorded } from '../packages/sdk/src/lang/testing';

const dir = join(import.meta.dir, 'courses');
const doc = await loadDocument(async (p) => readFileSync(join(dir, p), 'utf8'));
const H = 3600_000;
const NOW = Date.parse('2026-10-20T12:00:00+08:00');
const DUE_11 = Date.parse('2026-11-03T23:59:00+08:00');

/** A recorded test's responses, each usable many times, with optional body overrides by match. */
function responses(name: string, override: Record<string, string> = {}): Recorded[] {
  const t = YAML.parse(readFileSync(join(dir, 'tests', `${name}.yaml`), 'utf8')) as { responses: Recorded[] };
  const rs = t.responses.map((r) => (r.match in override ? { ...r, file: undefined, text: override[r.match] } : r.file ? { ...r, text: readFileSync(join(dir, 'tests', r.file), 'utf8') } : r));
  return rs.flatMap((r) => Array.from({ length: 10 }, () => ({ ...r })));
}

type Todo = { id: string; title: string; notes?: string; dueAt: number | null; doneAt: number | null; remind?: unknown };
function todoStore() {
  const store = new Map<string, Todo>();
  let n = 0;
  return {
    store,
    todos: {
      list: () => [...store.values()].map((t) => ({ ...t })),
      add: async (input: Omit<Todo, 'id' | 'doneAt'>) => {
        const todo = { ...input, id: `t${++n}`, doneAt: null };
        store.set(todo.id, todo);
        return todo;
      },
      update: async (id: string, patch: Partial<Todo>) => {
        const todo = { ...store.get(id)!, ...patch };
        store.set(id, todo);
        return todo;
      },
      setDone: async (id: string, done: boolean) => {
        const todo = { ...store.get(id)!, doneAt: done ? NOW : null };
        store.set(id, todo);
        return todo;
      },
      remove: async (id: string) => void store.delete(id),
    },
  };
}

const NEW_DEADLINE = '<div class="itemdates">截止日期: 2026年11月5日 星期四 下午11:59</div>';
const SUBMITTED = '<h3 id="currentAttempt_label">尝试 2026-10-21</h3>';

describe('courses: syncDeadlines', () => {
  test('adds unsubmitted upcoming ones, then keeps, updates, completes; never duplicates', async () => {
    const { store, todos } = todoStore();
    const run = async (override: Record<string, string> = {}) => {
      const r = replayEnv(doc, responses('assignments', override), { now: NOW, services: { todos } as never, kv });
      const out = await runTool(r.env, 'syncDeadlines', {});
      for (const [k, v] of r.kv.data) kv[k] = v;
      return out;
    };
    // One KV across runs, as on the phone.
    const kv: Record<string, unknown> = {};
    const first = await (async () => {
      const { env, kv: mem } = replayEnv(doc, responses('assignments'), { now: NOW, services: { todos } as never });
      const r = await runTool(env, 'syncDeadlines', { remindHours: 48 });
      for (const [k, v] of mem.data) kv[k] = v;
      return r;
    })();
    // _11_1 is open and upcoming; _12_1 was submitted; _13_1 is past.
    expect(first).toEqual({ added: ['交作业：作业一'], updated: [], completed: [], kept: 0, assignments: 3 });
    expect([...store.values()]).toEqual([
      { id: 't1', title: '交作业：作业一', notes: '高等数学 · 教学网作业', dueAt: DUE_11, remind: { type: 'at', at: DUE_11 - 48 * H }, doneAt: null },
    ]);

    const keepEnv = replayEnv(doc, responses('assignments'), { now: NOW, services: { todos } as never, kv });
    expect(await runTool(keepEnv.env, 'syncDeadlines', {})).toEqual({ added: [], updated: [], completed: [], kept: 1, assignments: 3 });
    for (const [k, v] of keepEnv.kv.data) kv[k] = v;
    expect(store.size).toBe(1);

    const moved = await run({ 'action=newAttempt&content_id=_11_1&': NEW_DEADLINE });
    expect(moved).toEqual({ added: [], updated: ['交作业：作业一'], completed: [], kept: 0, assignments: 3 });
    const due = Date.parse('2026-11-05T23:59:00+08:00');
    expect(store.get('t1')).toMatchObject({ dueAt: due, remind: { type: 'at', at: due - 24 * H } });

    const done = await run({ 'mode=view&content_id=_11_1&': SUBMITTED });
    expect(done).toEqual({ added: [], updated: [], completed: ['交作业：作业一'], kept: 0, assignments: 3 });
    expect(store.get('t1')?.doneAt).toBe(NOW);
    // Done to-dos are kept as they are.
    expect(await run()).toEqual({ added: [], updated: [], completed: [], kept: 1, assignments: 3 });
  });

  test('a to-do the user deleted is not recreated; the TS-era map carries over', async () => {
    const { store, todos } = todoStore();
    // As the TS plugin stored it: plain kv `sync.todos`, outside the document's namespace.
    const kv = { 'sync.todos': { '_8001_1:_11_1': 'gone', '_8001_1:_12_1': null } };
    const { env, kv: mem } = replayEnv(doc, responses('assignments'), { now: NOW, services: { todos } as never, kv });
    expect(await runTool(env, 'syncDeadlines', {})).toEqual({ added: [], updated: [], completed: [], kept: 0, assignments: 3 });
    expect(store.size).toBe(0);
    expect((mem.data.get('doc:sync.todos') as { v: unknown }).v).toEqual({ '_8001_1:_11_1': null, '_8001_1:_12_1': null });
  });

  test('a reminder that would be in the past moves to an hour before, or is dropped', async () => {
    const { store, todos } = todoStore();
    const soon = (h: number) => Date.parse('2026-10-20T12:00:00+08:00') + h * H;
    const at = (ms: number) => new Date(ms + 8 * H).toISOString().replace(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+).*$/, (_m, y, mo, d, hh, mi) => `${y}年${Number(mo)}月${Number(d)}日 星期二 ${Number(hh) >= 12 ? '下午' : '上午'}${Number(hh) % 12 || 12}:${mi}`);
    const run = (h: number) => replayEnv(doc, responses('assignments', { 'action=newAttempt&content_id=_11_1&': `<div class="itemdates">截止日期: ${at(soon(h))}</div>` }), { now: NOW, services: { todos } as never });
    await runTool(run(10).env, 'syncDeadlines', {});
    expect(store.get('t1')?.remind).toEqual({ type: 'at', at: soon(9) });
    store.clear();
    await runTool(run(0.5).env, 'syncDeadlines', {});
    expect([...store.values()][0]?.remind).toBeNull();
  });
});

describe('courses: play', () => {
  test('opens the signed playlist in the browser and returns only { opened: true }', async () => {
    const opened: string[] = [];
    const m3u8 = 'https://v.example/1.m3u8?sig=secret';
    const rs = responses('play-not-m3u8', {
      'get-sub-info-by-auth-data': JSON.stringify({ list: [{ sub_content: JSON.stringify({ save_playback: { is_m3u8: 'yes', contents: m3u8 } }) }] }),
    });
    const { env, seen } = replayEnv(doc, rs, { now: NOW, services: { browser: { open: async (u: string) => void opened.push(u) } } as never });
    const url = 'https://course.pku.edu.cn/webapps/bb-streammedia-hqy-BBLEARN/videoPlay.action?course_id=_8001_1&sub_id=1';
    expect(await runTool(env, 'play', { courseId: '_8001_1', url })).toEqual({ opened: true });
    expect(opened).toEqual([m3u8]);
    // The play page is fetched with its token (the model only saw the redacted link).
    expect(seen.map((r) => r.url)).toContain(`${url}&token=eyJabc.def`);
    expect(seen.at(-1)?.url).toContain('auth_data=a%2Bb');
  });

  // Found on device 2026-11-07: the iframe now goes through yjapise's casapi login, whose src has
  // `&timestamp=`; decoding it as `&times` (×) made the server answer 请求参数中缺少字段：timestamp.
  test('keeps &timestamp in the iframe link literal (attribute decoding as in a browser)', async () => {
    const src = '/webapps/bb-streammedia-hqy-BBLEARN/iframe.action?r=auth/login&amp;tenant_code=1&timestamp=1762500000&copy=2';
    const rs = responses('play-not-m3u8', { 'videoPlay.action?course_id=_8001_1&sub_id=1': `<div id="content"><iframe src="${src}"></iframe></div>` });
    const { env, seen } = replayEnv(doc, rs, { now: NOW, services: { browser: { open: async () => {} } } as never });
    await runTool(env, 'play', { courseId: '_8001_1', url: 'https://course.pku.edu.cn/webapps/bb-streammedia-hqy-BBLEARN/videoPlay.action?course_id=_8001_1&sub_id=1' }).catch(() => null);
    expect(seen.map((r) => r.url)).toContain('https://course.pku.edu.cn/webapps/bb-streammedia-hqy-BBLEARN/iframe.action?r=auth/login&tenant_code=1&timestamp=1762500000&copy=2');
  });
});
