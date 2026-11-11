import { describe, expect, test } from 'bun:test';

import { cleanTranscript, openAITranscribe } from './transcribe';

const audio = { file: new Blob([new Uint8Array([0, 1, 2])], { type: 'audio/mp4' }), uri: 'file:///rec.m4a', name: 'rec.m4a', mimeType: 'audio/mp4' };

function fakeFetch(status: number, body: string, seen: { url?: string; init?: RequestInit } = {}) {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

describe('openAITranscribe', () => {
  test('posts the file and model to /audio/transcriptions and returns the text', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const text = await openAITranscribe({ baseURL: 'https://api.siliconflow.cn/v1/', model: 'FunAudioLLM/SenseVoiceSmall', credential: 'k', fetch: fakeFetch(200, '{"text":"明天早上八点提醒我交作业"}', seen) }, audio);
    expect(text).toBe('明天早上八点提醒我交作业');
    expect(seen.url).toBe('https://api.siliconflow.cn/v1/audio/transcriptions');
    expect((seen.init?.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const form = seen.init?.body as FormData;
    expect(form.get('model')).toBe('FunAudioLLM/SenseVoiceSmall');
    expect((form.get('file') as File).name).toBe('rec.m4a');
  });

  test("surfaces the provider's error message", async () => {
    const run = openAITranscribe({ baseURL: 'https://x/v1', model: 'm', credential: 'bad', fetch: fakeFetch(401, '{"error":{"message":"Invalid token"}}') }, audio);
    await expect(run).rejects.toThrow('401: Invalid token');
  });

  test('a body without text is an error, not an empty transcript', async () => {
    await expect(openAITranscribe({ baseURL: 'https://x/v1', model: 'm', fetch: fakeFetch(200, '{"foo":1}') }, audio)).rejects.toThrow();
  });
});

describe('cleanTranscript', () => {
  test('drops SenseVoice control tokens', () => {
    expect(cleanTranscript('<|zh|><|NEUTRAL|><|Speech|><|withitn|>你好，世界。')).toBe('你好，世界。');
  });
});
