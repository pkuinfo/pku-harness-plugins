import { describe, expect, test } from 'bun:test';

import type { SpeechConfig, ToolContext } from '@pku-harness/sdk';

import { cleanOcr, deepseekOcr, deepseekTranscribe, webTools } from './tools';

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: string) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const speech = (f: typeof fetch, baseURL = 'https://api.deepseek.com'): SpeechConfig => ({
  baseURL,
  model: 'asr',
  credential: 'sk-test',
  fetch: f,
  webSocket: () => {
    throw new Error('unused');
  },
});
const audio = { file: new Blob(['RIFF']), uri: 'file:///a.wav', name: 'a.wav', mimeType: 'audio/wav' };

describe('deepseekTranscribe', () => {
  test('posts the recording to /v1/tools/asr with the key and returns the text', async () => {
    const { f, calls } = fakeFetch(200, JSON.stringify({ request_id: 'r', text: ' 你好 ', duration_ms: 900 }));
    expect(await deepseekTranscribe(speech(f, 'https://api.deepseek.com/v1/'), audio)).toBe('你好');
    expect(calls[0]!.url).toBe('https://api.deepseek.com/v1/tools/asr');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect((calls[0]!.init.body as FormData).get('model')).toBeNull();
  });

  test('reports the service error', async () => {
    const { f } = fakeFetch(400, JSON.stringify({ error: { message: 'audio must be 16-bit PCM WAV' } }));
    await expect(deepseekTranscribe(speech(f), audio)).rejects.toThrow('400: audio must be 16-bit PCM WAV');
  });
});

describe('deepseekOcr', () => {
  test('sends purpose before file and joins pages with headings, keepalive newlines included', async () => {
    const body = `\n\n${JSON.stringify({ pages: [{ index: 0, text: '<｜ref｜>标题<｜/ref｜><｜box｜>[[1, 2, 3, 4]]<｜/box｜>\n正文', finish_reason: 'stop' }, { index: 1, text: 'b', finish_reason: 'length' }] })}`;
    const { f, calls } = fakeFetch(200, body);
    const text = await deepseekOcr.recognize({ baseURL: 'https://api.deepseek.com', credential: 'k', fetch: f }, { ...audio, name: 'a.pdf', mimeType: 'application/pdf' });
    expect(text).toBe('## Page 1\n\n标题\n正文\n\n## Page 2\n\nb\n\n[…page text incomplete]');
    expect([...(calls[0]!.init.body as FormData).keys()]).toEqual(['purpose', 'file']);
  });

  test('a late failure arrives as an error object in a 200', async () => {
    const { f } = fakeFetch(200, `\n${JSON.stringify({ error: { message: 'OCR did not finish in time' } })}`);
    await expect(deepseekOcr.recognize({ baseURL: 'https://api.deepseek.com', credential: 'k', fetch: f }, audio)).rejects.toThrow('OCR did not finish in time');
  });
});

test('cleanOcr drops boxes and markup tokens', () => {
  expect(cleanOcr('<｜ref｜>A<｜/ref｜><｜box｜>[[0, 0, 9, 9]]<｜/box｜>  \n\n\n\nB<｜grounding｜>')).toBe('A\n\nB');
});

describe('web tools', () => {
  const ctx = (credential?: string) => ({ provider: async () => ({ baseURL: 'https://api.deepseek.com', credential }) }) as unknown as ToolContext;

  test('web_search needs the DeepSeek key', async () => {
    await expect(webTools.web_search.execute({ query: 'x' }, ctx())).rejects.toThrow('DeepSeek API key');
  });

  test('web_search maps results', async () => {
    const real = globalThis.fetch;
    const { f, calls } = fakeFetch(200, JSON.stringify({ results: [{ title: 'T', url: 'https://e.com', snippet: 's', summary: 'long', site_name: 'E', site_icon: null, date: null, authority: 3, rerank_score: 2 }] }));
    globalThis.fetch = f;
    try {
      expect(await webTools.web_search.execute({ query: '北大 选课' }, ctx('k'))).toEqual({ results: [{ title: 'T', url: 'https://e.com', site: 'E', date: undefined, summary: 'long' }] });
      expect(calls[0]!.url).toBe('https://api.deepseek.com/v1/tools/search');
      expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ query: '北大 选课', count: 6 });
    } finally {
      globalThis.fetch = real;
    }
  });

  test('web_read pages through long content', async () => {
    const real = globalThis.fetch;
    const content = 'x'.repeat(13_000);
    globalThis.fetch = fakeFetch(200, JSON.stringify({ title: 'P', content })).f;
    try {
      const first = await webTools.web_read.execute({ url: 'https://e.com' }, ctx('k'));
      expect(first).toMatchObject({ title: 'P', offset: 0, next: 12_000, chars: 13_000 });
      const rest = await webTools.web_read.execute({ url: 'https://e.com', offset: 12_000 }, ctx('k'));
      expect(rest).toMatchObject({ offset: 12_000, next: null });
    } finally {
      globalThis.fetch = real;
    }
  });
});
