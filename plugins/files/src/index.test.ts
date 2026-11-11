import { describe, expect, test } from 'bun:test';
import type { FileInfo, FileReadResult, FileSearchResult, FilesService } from '@pku-harness/sdk';

import { DEFAULT_LENGTH, filesPlugin, inputs } from './index';

const TEXT = '第一章 总则\n本学期学费为 5,000 元。'.padEnd(30000, '。');
const DOC: FileInfo = { id: 'a1', name: '学费通知.pdf', kind: 'pdf', chars: TEXT.length, units: 3 };

/** A fake host: one attached document, calls recorded. */
function fakeFiles() {
  const calls: unknown[][] = [];
  const files: FilesService = {
    list: async () => (calls.push(['list']), [DOC]),
    read: async (id, offset = 0, length = DEFAULT_LENGTH): Promise<FileReadResult> => {
      calls.push(['read', id, offset, length]);
      if (id !== DOC.id) throw new Error('no such attachment');
      const end = Math.min(TEXT.length, offset + length);
      return { ...DOC, offset, text: TEXT.slice(offset, end), next: end < TEXT.length ? end : null };
    },
    search: async (id, query, max = 10): Promise<FileSearchResult> => {
      calls.push(['search', id, query, max]);
      const at = TEXT.indexOf(query);
      return { id, name: DOC.name, matches: at < 0 ? [] : [{ offset: at, snippet: TEXT.slice(Math.max(0, at - 5), at + 20) }] };
    },
  };
  return { calls, files };
}

const run = (services: object, tool: string, input: unknown) => {
  const t = filesPlugin.tools[tool]!;
  return t.execute(t.input.parse(input), { pluginId: 'files', actor: 'agent', kv: {}, services } as never) as Promise<any>;
};

describe('files plugin', () => {
  test('manifest: core, read-only, document text is untrusted', () => {
    expect(filesPlugin).toMatchObject({ id: 'files', core: true, icon: 'file' });
    const t = filesPlugin.tools;
    expect(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, [v.effect, !!v.untrusted]]))).toEqual({
      list: ['read', false],
      read: ['read', true],
      search: ['read', true],
    });
    expect(filesPlugin.instructions).toContain('<attachment');
  });

  test('list passes through', async () => {
    const { calls, files } = fakeFiles();
    expect(await run({ files }, 'list', {})).toEqual({ files: [DOC] });
    expect(calls).toEqual([['list']]);
  });

  test('read pages with defaults and next', async () => {
    const { calls, files } = fakeFiles();
    const first = await run({ files }, 'read', { id: 'a1' });
    expect(first).toMatchObject({ id: 'a1', offset: 0, next: DEFAULT_LENGTH });
    expect(first.text.length).toBe(DEFAULT_LENGTH);
    const last = await run({ files }, 'read', { id: 'a1', offset: 28000, length: 5000 });
    expect(last).toMatchObject({ offset: 28000, next: null });
    expect(calls).toEqual([
      ['read', 'a1', 0, DEFAULT_LENGTH],
      ['read', 'a1', 28000, 5000],
    ]);
    await expect(run({ files }, 'read', { id: 'zz' })).rejects.toThrow('no such attachment');
  });

  test('search passes query and max', async () => {
    const { calls, files } = fakeFiles();
    const r = await run({ files }, 'search', { id: 'a1', query: '5,000' });
    expect(r.matches[0].snippet).toContain('5,000 元');
    await run({ files }, 'search', { id: 'a1', query: '奖学金', max: 3 });
    expect(calls).toEqual([
      ['search', 'a1', '5,000', 10],
      ['search', 'a1', '奖学金', 3],
    ]);
  });

  test('input validation', () => {
    expect(inputs.read.safeParse({ id: 'a1', offset: 100, length: 500 }).success).toBe(true);
    expect(inputs.read.safeParse({ id: '' }).success).toBe(false);
    expect(inputs.read.safeParse({ id: 'a1', offset: -1 }).success).toBe(false);
    expect(inputs.read.safeParse({ id: 'a1', offset: 1.5 }).success).toBe(false);
    expect(inputs.read.safeParse({ id: 'a1', length: 499 }).success).toBe(false);
    expect(inputs.read.safeParse({ id: 'a1', length: 20001 }).success).toBe(false);
    expect(inputs.search.safeParse({ id: 'a1', query: '' }).success).toBe(false);
    expect(inputs.search.safeParse({ id: 'a1', query: 'x', max: 0 }).success).toBe(false);
    expect(inputs.search.safeParse({ id: 'a1', query: 'x', max: 21 }).success).toBe(false);
    expect(inputs.search.safeParse({ id: 'a1', query: 'x', max: 20 }).success).toBe(true);
  });
});
