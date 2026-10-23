import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { pluginsPlugin } from './index';

const dir = new URL('../../classrooms/', import.meta.url).pathname;
const files = Object.fromEntries(['PLUGIN.md', 'tools/free.yaml', 'tools/overview.yaml', 'widgets/overview.json'].map((p) => [p, readFileSync(dir + p, 'utf8')]));
const run = (tool: string, input: unknown, services: object = {}) => pluginsPlugin.tools[tool]!.execute(pluginsPlugin.tools[tool]!.input.parse(input), { services, kv: {} } as never);

describe('plugin authoring tools', () => {
  test('reference is the language in one page', async () => {
    expect(String(await run('reference', {}))).toContain('## Steps');
  });

  test('validate reports a summary or every issue', async () => {
    expect(await run('validate', { files })).toMatchObject({ ok: true, id: 'classrooms', tools: { free: 'read', overview: 'read' }, network: ['portal.pku.edu.cn'] });
    const broken = { ...files, 'tools/free.yaml': files['tools/free.yaml']!.replace('effect: read', 'effect: maybe') };
    const r = (await run('validate', { files: broken })) as { ok: boolean; issues: string[] };
    expect(r.ok).toBe(false);
    expect(r.issues.join('\n')).toContain('tools/free.yaml › effect');
  });

  test('tryTool runs read tools live, refuses others', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, rows: [{ buildingName: '二教', classroomFree: 3, classroomSum: 9 }] }))) as never;
    try {
      expect(await run('tryTool', { files, tool: 'overview' })).toMatchObject({ buildings: [{ building: '二教', free: 3, total: 9 }] });
    } finally {
      globalThis.fetch = real;
    }
    const writer = { ...files, 'tools/free.yaml': files['tools/free.yaml']!.replace('effect: read', 'effect: write') };
    await expect(run('tryTool', { files: writer, tool: 'free' })).rejects.toThrow(/only read tools/);
  });

  test('install only opens the review sheet', async () => {
    let reviewed: unknown;
    const services = { docs: { review: async (x: unknown) => ((reviewed = x), { opened: true }), source: () => null } };
    expect(await run('install', { link: 'https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/classrooms' }, services)).toMatchObject({ opened: true });
    expect(reviewed).toEqual({ link: 'https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/classrooms' });
    await expect(run('source', { id: 'wallet' }, services)).rejects.toThrow(/不是插件文档/);
  });
});
