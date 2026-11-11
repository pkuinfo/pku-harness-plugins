import { describe, expect, test } from 'bun:test';

import { cleanTranscript, openAITranscribe } from './speech';

const audio = { file: new Blob([new Uint8Array([0, 1, 2])], { type: 'audio/wav' }), uri: 'file:///rec.wav', name: 'rec.wav', mimeType: 'audio/wav' };
const noSocket = () => {
  throw new Error('no WebSocket in this test');
};

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
    const text = await openAITranscribe({ baseURL: 'https://api.siliconflow.cn/v1/', model: 'FunAudioLLM/SenseVoiceSmall', credential: 'k', fetch: fakeFetch(200, '{"text":"明天早上8点提醒我交作业"}', seen), webSocket: noSocket }, audio);
    expect(text).toBe('明天早上8点提醒我交作业');
    expect(seen.url).toBe('https://api.siliconflow.cn/v1/audio/transcriptions');
    expect((seen.init?.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const form = seen.init?.body as FormData;
    expect(form.get('model')).toBe('FunAudioLLM/SenseVoiceSmall');
    expect((form.get('file') as File).name).toBe('rec.wav');
  });

  test("surfaces the provider's error message", async () => {
    await expect(openAITranscribe({ baseURL: 'https://x/v1', model: 'm', credential: 'bad', fetch: fakeFetch(401, '{"error":{"message":"Invalid token"}}'), webSocket: noSocket }, audio)).rejects.toThrow('401: Invalid token');
  });

  test('a body without text is an error, not an empty transcript', async () => {
    await expect(openAITranscribe({ baseURL: 'https://x/v1', model: 'm', fetch: fakeFetch(200, '{"foo":1}'), webSocket: noSocket }, audio)).rejects.toThrow();
  });
});

describe('cleanTranscript', () => {
  test('drops SenseVoice control tokens', () => {
    expect(cleanTranscript('<|zh|><|NEUTRAL|><|Speech|><|withitn|>你好，世界。')).toBe('你好，世界。');
  });
});
