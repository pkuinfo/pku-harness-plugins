import { describe, expect, test } from 'bun:test';
import type { MarketplaceHit, PluginDetail } from '@pku-harness/sdk';

import { pluginsPlugin } from './index';

const run = (tool: string, input: unknown, services: object) => pluginsPlugin.tools[tool]!.execute(pluginsPlugin.tools[tool]!.input.parse(input), { services, kv: {} } as never) as Promise<any>;

const detail = (d: Partial<PluginDetail> & { id: string }): PluginDetail => ({ name: d.id, description: '', core: false, enabled: true, unavailable: null, tools: [{ name: `${d.id}__x`, title: 'X', effect: 'read' }], ...d });
const PLUGINS: Record<string, PluginDetail> = {
  classrooms: detail({ id: 'classrooms', name: '空闲教室', description: '查教学楼里现在空着的教室', instructions: '用 classrooms__free。' }),
  treehole: detail({ id: 'treehole', name: '树洞', description: '浏览和搜索树洞', enabled: false }),
  copilot: detail({ id: 'copilot', name: 'Copilot', description: '操作手机上的应用', unavailable: 'needs phone control' }),
  deepseek: detail({ id: 'deepseek', name: 'DeepSeek', description: 'AI 服务', tools: [] }),
};
const HIT: MarketplaceHit = { id: 'lib-seat', name: '图书馆座位', description: '查图书馆空座', author: 'someone', official: false, verified: false, installed: false, link: 'https://github.com/someone/lib-seat', endpoint: null };

function services(market: () => Promise<MarketplaceHit[]> = async () => [HIT]) {
  return {
    registry: {
      plugins: () => Object.values(PLUGINS).map((p) => ({ id: p.id })),
      describe: (id: string) => PLUGINS[id] ?? null,
      marketplace: market,
    },
  };
}

describe('plugins.search', () => {
  test('finds installed plugins by need, and marketplace plugins to install', async () => {
    const r = await run('search', { query: '教室' }, services());
    expect(r.installed.map((p: { id: string }) => p.id)).toEqual(['classrooms']);
    expect(r.marketplace).toEqual([HIT]);
  });
  test('plugins without tools are not offered; an unreachable marketplace still returns installed matches', async () => {
    const r = await run('search', { query: 'AI 服务' }, services(async () => { throw new Error('offline'); }));
    expect(r.installed).toEqual([]);
    expect(r.marketplace).toEqual([]);
  });
});

describe('plugins.use', () => {
  test('returns instructions and tools for usable plugins, a reason for the others', async () => {
    const r = await run('use', { ids: ['classrooms', 'treehole', 'copilot', 'nope'] }, services());
    expect(r.loaded[0]).toMatchObject({ id: 'classrooms', instructions: '用 classrooms__free。', tools: [{ name: 'classrooms__x' }] });
    expect(r.loaded[1]).toMatchObject({ id: 'treehole', error: expect.stringContaining('settings__change plugin.treehole.enabled') });
    expect(r.loaded[2].error).toContain('needs phone control');
    expect(r.loaded[3].error).toContain('plugins__search');
  });
});
