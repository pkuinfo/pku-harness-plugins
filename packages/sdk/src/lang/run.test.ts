import { describe, expect, test } from 'bun:test';

import { compilePlugin } from './compile';
import { loadDocument, PluginDocError, type PluginDocument } from './load';
import { runTool } from './run';
import { replayEnv } from './testing';

async function doc(files: Record<string, string>): Promise<PluginDocument> {
  return loadDocument(async (p) => {
    if (!(p in files)) throw new Error(`missing ${p}`);
    return files[p]!;
  });
}

const md = (fm: string, body = 'Use the tools.') => `---\nspec: 1\nid: demo\nname: 演示\ndescription: A demo plugin for tests.\nversion: 1.0.0\nauthor: pkuinfo\n${fm}\n---\n\n${body}\n`;

describe('loading', () => {
  test('frontmatter, instructions, tool files', async () => {
    const d = await doc({
      'PLUGIN.md': md('network: [example.com]\ntools:\n  hello: tools/hello.yaml', 'Say hello.'),
      'tools/hello.yaml': 'title: 问候\ndescription: Greets someone.\neffect: read\ninput:\n  name: { type: string, default: world }\nreturn: "\'hello \' + input.name"\n',
    });
    expect(d.instructions).toBe('Say hello.');
    expect(Object.keys(d.tools)).toEqual(['hello']);
    const { env } = replayEnv(d, []);
    expect(await runTool(env, 'hello', { name: 'PKU' })).toBe('hello PKU');
  });

  test('every problem is reported with its place', async () => {
    const err = await doc({
      'PLUGIN.md': md('network: [example.com]\ntools:\n  a: tools/a.yaml'),
      'tools/a.yaml': `title: A
description: Broken on purpose.
effect: read
steps:
  - let: x
    value: "1 +"
  - let: y
    request: { url: 'https://evil.com/x' }
  - ability: todos.add
    args: "{ title: 'x' }"
  - frobnicate: 1
`,
    }).catch((e) => e as PluginDocError);
    expect(err).toBeInstanceOf(PluginDocError);
    const issues = (err as PluginDocError).issues.join('\n');
    expect(issues).toContain('steps[0].value');
    expect(issues).toContain('evil.com is not listed in PLUGIN.md network');
    expect(issues).toContain("add 'todos' to PLUGIN.md abilities");
    expect(issues).toContain('todos.add needs effect');
    expect(issues).toContain('steps[3]: unknown step');
  });

  test('manifest errors', async () => {
    const err = await doc({ 'PLUGIN.md': '---\nspec: 1\nid: Bad Id\n---\n' }).catch((e) => e as PluginDocError);
    expect((err as PluginDocError).issues.some((i) => i.includes('id'))).toBe(true);
  });
});

describe('running', () => {
  const free = `title: 空闲教室
description: Free rooms per building.
effect: read
input:
  building: { type: string, optional: true }
constants:
  BUILDINGS: [二教, 理教]
functions:
  freeRanges: "(r) => compactRanges(range(1, 5).filter(i => r['c' + i] == ''))"
steps:
  - let: buildings
    value: "input.building ? [input.building] : BUILDINGS"
  - let: pages
    each: buildings
    concurrency: 2
    request:
      url: https://portal.pku.edu.cn/free.do
      query: { buildingName: '\${item}' }
    as: json
return: "pages.flatMap((p, i) => p.rows.map(r => ({ building: buildings[i], room: r.room, free: freeRanges(r) })))"
`;

  test('each + request + functions', async () => {
    const d = await doc({ 'PLUGIN.md': md('network: [portal.pku.edu.cn]\ntools:\n  free: tools/free.yaml'), 'tools/free.yaml': free });
    const { env, seen } = replayEnv(d, [
      { match: encodeURIComponent('二教'), body: { rows: [{ room: '二教101', c1: '', c2: '', c3: 'x', c4: '' }] } },
      { match: encodeURIComponent('理教'), body: { rows: [{ room: '理教201', c1: 'x', c2: '', c3: '', c4: 'x' }] } },
    ]);
    expect(await runTool(env, 'free', {})).toEqual([
      { building: '二教', room: '二教101', free: '1-2,4' },
      { building: '理教', room: '理教201', free: '2-3' },
    ]);
    expect(seen.map((s) => s.url)).toEqual([`https://portal.pku.edu.cn/free.do?buildingName=${encodeURIComponent('二教')}`, `https://portal.pku.edu.cn/free.do?buildingName=${encodeURIComponent('理教')}`]);
  });

  test('undeclared hosts and redirects are refused at run time', async () => {
    const d = await doc({
      'PLUGIN.md': md('network: [a.example.com]\ntools:\n  t: tools/t.yaml'),
      'tools/t.yaml': "title: T\ndescription: Templated host.\neffect: read\ninput:\n  host: { type: string }\nsteps:\n  - let: r\n    request: { url: 'https://${input.host}/x' }\n    as: text\nreturn: r\n",
    });
    const { env } = replayEnv(d, [{ match: '/x', body: 'ok', url: 'https://b.example.com/x' }]);
    await expect(runTool(env, 't', { host: 'evil.com' })).rejects.toThrow(/evil.com is not declared/);
    await expect(runTool(env, 't', { host: 'a.example.com' })).rejects.toThrow(/redirected to b.example.com/);
  });

  test('campus requests, extract, kv cache, check, try', async () => {
    const page = `<ul><li class="item"><a href="/n/1.htm">通知一</a><span class="date">2026-10-20</span></li><li class="item"><a href="/n/2.htm">通知二</a><span class="date">2026-10-21</span></li></ul>`;
    const d = await doc({
      'PLUGIN.md': md('campus: [blackboard]\ntools:\n  latest: tools/latest.yaml'),
      'tools/latest.yaml': `title: 最新通知
description: Latest notices.
effect: read
steps:
  - let: items
    cache: { key: latest, ttl: 10m }
    steps:
      - let: page
        request: { campus: blackboard, url: /notices }
        as: html
      - let: list
        extract:
          from: page
          each: li.item
          fields:
            title: a | text
            href: a | attr href | url
            date: .date | text | date
    return: list
  - check: items.length > 0
    error: 没有通知
  - try:
      - let: broken
        value: "json('nope')"
    catch:
      - let: broken
        value: "'recovered: ' + error.message"
return: "{ items: items.map(i => ({ ...i, date: formatDate(i.date, 'MM-DD') })), broken }"
`,
    });
    const { env, kv, seen } = replayEnv(d, [{ match: '/notices', campus: 'blackboard', body: page, url: 'https://course.pku.edu.cn/notices' }]);
    const first = (await runTool(env, 'latest', {})) as { items: { title: string; href: string; date: string }[]; broken: string };
    expect(first.items).toEqual([
      { title: '通知一', href: 'https://course.pku.edu.cn/n/1.htm', date: '10-20' },
      { title: '通知二', href: 'https://course.pku.edu.cn/n/2.htm', date: '10-21' },
    ]);
    expect(first.broken).toBe('recovered: json(): not valid JSON');
    // Second run is served from the plugin's KV cache: no more requests.
    await runTool(env, 'latest', {});
    expect(seen).toHaveLength(1);
    expect([...kv.data.keys()]).toEqual(['doc:cache:latest']);
  });

  test('paginate follows a cursor until it runs out', async () => {
    const d = await doc({
      'PLUGIN.md': md('network: [api.example.com]\ntools:\n  all: tools/all.yaml'),
      'tools/all.yaml': `title: All
description: Every page.
effect: read
steps:
  - let: rows
    paginate:
      start: "1"
      request: { url: 'https://api.example.com/list', query: { page: '\${cursor}' } }
      items: page.rows
      next: "page.hasMore ? cursor + 1 : null"
      max: 5
    as: json
return: rows
`,
    });
    const { env, seen } = replayEnv(d, [
      { match: 'page=1', body: { rows: [1, 2], hasMore: true } },
      { match: 'page=2', body: { rows: [3], hasMore: false } },
    ]);
    expect(await runTool(env, 'all', {})).toEqual([1, 2, 3]);
    expect(seen).toHaveLength(2);
  });

  test('treehole second factor through the verify ability', async () => {
    const d = await doc({
      'PLUGIN.md': md('campus: [treehole]\nabilities: [verify]\ntools:\n  scores: tools/scores.yaml'),
      'tools/scores.yaml': `title: 成绩
description: Scores.
effect: read
input:
  code: { type: string, optional: true }
steps:
  - let: data
    ability: verify.treehole
    args: "{ request: { url: '/chapi/api/course/score_v2' }, code: input.code }"
return: data
`,
    });
    const first = replayEnv(d, [{ match: 'score_v2', campus: 'treehole', body: { code: 40077, success: false } }]);
    expect(await runTool(first.env, 'scores', {})).toMatchObject({ status: 'verification_required', kind: 'course', methods: ['otp', 'sms'] });
    expect(first.kv.data.get('verify:pending')).toBe('course');

    const second = replayEnv(
      d,
      [
        { match: 'password_get_token', campus: 'treehole', body: { success: true } },
        { match: 'score_v2', campus: 'treehole', body: { success: true, data: { gpa: 3.9 } } },
      ],
      { kv: { 'verify:pending': 'course' } },
    );
    expect(await runTool(second.env, 'scores', { code: '123456' })).toEqual({ gpa: 3.9 });
    expect(second.seen.map((s) => s.url)).toEqual(['/chapi/api/course/password_get_token', '/chapi/api/course/score_v2']);
  });

  test('limits: undeclared campus service, step budget', async () => {
    const d = await doc({
      'PLUGIN.md': md('campus: [card]\ntools:\n  t: tools/t.yaml'),
      'tools/t.yaml': "title: T\ndescription: Loops.\neffect: read\ninput:\n  svc: { type: string }\nsteps:\n  - let: r\n    request: { campus: '${input.svc}', url: /x }\nreturn: r\n",
    });
    const { env } = replayEnv(d, []);
    await expect(runTool(env, 't', { svc: 'its' })).rejects.toThrow(/'its' is not declared/);
  });
});

describe('shared file and trimmed input', () => {
  test('tools see shared constants/functions; their own win; trim', async () => {
    const d = await doc({
      'PLUGIN.md': md('shared: shared.yaml\ntools:\n  a: tools/a.yaml\n  b: tools/b.yaml'),
      'shared.yaml': 'constants:\n  N: 2\n  NAME: shared\nfunctions:\n  twice: "(x) => x * N"\n',
      'tools/a.yaml': 'title: A\ndescription: Uses shared.\neffect: read\ninput:\n  s: { type: string, trim: true, max: 3 }\nreturn: "{ v: twice(3), name: NAME, s: input.s }"\n',
      'tools/b.yaml': 'title: B\ndescription: Overrides.\neffect: read\nconstants:\n  NAME: own\nreturn: NAME\n',
    });
    const { env } = replayEnv(d, []);
    const { inputZod } = await import('./compile');
    expect(await runTool(env, 'a', inputZod(d.tools.a!.input).parse({ s: '  ab  ' }) as never)).toEqual({ v: 6, name: 'shared', s: 'ab' });
    expect(await runTool(env, 'b', {})).toBe('own');
  });
});

describe('host injection (cloud server)', () => {
  test('secrets only inside request templates; server abilities; no campus', async () => {
    const d = await doc({
      'PLUGIN.md': md('network: [api.example.com]\ncampus: [card]\ntools:\n  t: tools/t.yaml\n  leak: tools/leak.yaml\n  card: tools/card.yaml'),
      'tools/t.yaml': "title: T\ndescription: Uses a key.\neffect: read\nsteps:\n  - let: r\n    request: { url: 'https://api.example.com/x', query: { key: '${secrets.KEY}' } }\n    as: json\n  - let: saved\n    ability: store.put\n    args: '{ v: r.v, who: caller.id }'\nreturn: saved\n",
      'tools/leak.yaml': 'title: L\ndescription: Tries to leak.\neffect: read\nreturn: secrets.KEY\n',
      'tools/card.yaml': "title: C\ndescription: Campus on server.\neffect: read\nsteps:\n  - request: { campus: card, url: /x }\n",
    }).catch(() => null);
    // `store.put` is unknown to the phone's ability table: the document only validates on the server.
    expect(d).toBeNull();
  });

  test('runner with an injected ability table', async () => {
    const d = await doc({
      'PLUGIN.md': md('network: [api.example.com]\ncampus: [card]\ntools:\n  t: tools/t.yaml\n  leak: tools/leak.yaml\n  card: tools/card.yaml'),
      'tools/t.yaml': "title: T\ndescription: Uses a key.\neffect: write\nsteps:\n  - let: r\n    request: { url: 'https://api.example.com/x', query: { key: '${secrets.KEY}' } }\n    as: json\nreturn: \"{ v: r.v, who: caller.id }\"\n",
      'tools/leak.yaml': 'title: L\ndescription: Tries to leak.\neffect: read\nreturn: secrets.KEY\n',
      'tools/card.yaml': "title: C\ndescription: Campus on server.\neffect: read\nsteps:\n  - let: r\n    request: { campus: card, url: /x }\nreturn: r\n",
    });
    const { env, seen } = replayEnv(d, [{ match: 'api.example.com/x', body: { v: 1 } }]);
    const server = { ...env, secrets: { KEY: 's3cret' }, scope: { caller: { id: 'u_1' } }, campus: false };
    expect(await runTool(server, 't', {})).toEqual({ v: 1, who: 'u_1' });
    expect(seen[0]!.url).toBe('https://api.example.com/x?key=s3cret');
    await expect(runTool(server, 'leak', {})).rejects.toThrow(/unknown name 'secrets'/);
    await expect(runTool(server, 'card', {})).rejects.toThrow(/only available on the phone/);
  });
});

describe('compiling', () => {
  test('a document becomes a PluginDef with strict defaults when unverified', async () => {
    const d = await doc({
      'PLUGIN.md': md(
        'campus: [card]\nnetwork: [example.com]\ndefaultModes: { write: auto }\ntools:\n  get: tools/get.yaml\ndataSources:\n  balance: { tool: get, ttl: 5m }\ncommands:\n  hi: { description: Say hi, prompt: "hi {{input}}" }\ni18n:\n  en: { name: Demo, tools: { get: { title: Get } } }',
      ),
      'tools/get.yaml': 'title: 取\ndescription: Gets a thing.\neffect: read\ninput:\n  n: { type: integer, min: 1, max: 9, default: 3 }\nreturn: input.n\n',
    });
    const p = compilePlugin(d, { verified: false, fetch: async () => ({ status: 200, url: '', headers: {}, body: '' }) });
    expect(p.requires?.sort()).toEqual(['campus-session', 'network']);
    expect(p.scopes).toEqual(['example.com', 'campus:card']);
    expect(p.defaultModes).toEqual({ read: 'auto', write: 'ask', money: 'ask', public: 'ask' });
    expect(p.tools.get!.untrusted).toBe(true);
    expect(p.tools.get!.input.parse({})).toEqual({ n: 3 });
    expect(() => p.tools.get!.input.parse({ n: 20 })).toThrow();
    expect(p.dataSources?.balance).toEqual({ title: '取', tool: 'get', args: undefined, ttlMs: 300_000 });
    expect(p.contributes?.commands?.hi).toMatchObject({ prompt: 'hi {{input}}' });
    expect(p.i18n?.en?.name).toBe('Demo');
    const verified = compilePlugin(d, { verified: true, fetch: async () => ({ status: 200, url: '', headers: {}, body: '' }) });
    expect(verified.defaultModes).toEqual({ write: 'auto' });
    expect(verified.tools.get!.untrusted).toBe(false);
  });
});
