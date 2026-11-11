import { describe, expect, test } from 'bun:test';

import { dashscopeRealtime, Transcript } from './realtime';

type Sent = string | Uint8Array;

/** A scripted DashScope socket: records what the client sends and plays server events back. */
class FakeSocket {
  sent: Sent[] = [];
  closed = false;
  onopen?: () => void;
  onmessage?: (m: { data: string }) => void;
  onerror?: () => void;
  onclose?: (c: { code: number; reason: string }) => void;
  send(data: Sent) {
    this.sent.push(data);
    if (typeof data === 'string' && JSON.parse(data).header.action === 'finish-task') {
      this.emit('result-generated', { output: { sentence: { text: '顺便查一下校园卡余额。', sentence_end: true } } });
      this.emit('task-finished');
    }
  }
  close() {
    this.closed = true;
  }
  emit(event: string, payload: unknown = {}, header: Record<string, string> = {}) {
    this.onmessage?.({ data: JSON.stringify({ header: { event, ...header }, payload }) });
  }
  json(i: number) {
    return JSON.parse(this.sent[i] as string);
  }
}

const config = (socket: FakeSocket, seen?: { url?: string; headers?: Record<string, string> }) => ({
  baseURL: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/',
  model: 'paraformer-realtime-v2',
  credential: 'k',
  fetch,
  webSocket: (url: string, headers: Record<string, string>) => {
    if (seen) Object.assign(seen, { url, headers });
    return socket as unknown as WebSocket;
  },
});

describe('Transcript', () => {
  test('a growing sentence replaces its text; ended sentences accumulate; heartbeats are ignored', () => {
    const t = new Transcript();
    t.apply({ text: '明天' });
    t.apply({ text: '明天早上八点' });
    expect(t.toString()).toBe('明天早上八点');
    t.apply({ text: '明天早上八点提醒我。', sentence_end: true });
    expect(t.apply({ heartbeat: true })).toBe(false);
    t.apply({ text: '顺便' });
    expect(t.toString()).toBe('明天早上八点提醒我。顺便');
  });
});

describe('dashscopeRealtime', () => {
  test('runs a 16 kHz PCM task, holds audio until it starts, streams text, finishes with the transcript', async () => {
    const socket = new FakeSocket();
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const texts: string[] = [];
    const pending = dashscopeRealtime(config(socket, seen), { onText: (t) => texts.push(t) });
    socket.onopen?.();
    const stream = await pending;
    expect(seen).toEqual({ url: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', headers: { Authorization: 'Bearer k' } });
    const run = socket.json(0);
    expect(run.header).toMatchObject({ action: 'run-task', streaming: 'duplex' });
    expect(run.payload).toMatchObject({ model: 'paraformer-realtime-v2', parameters: { format: 'pcm', sample_rate: 16000 } });
    stream.send(btoa('\x01\x02'));
    expect(socket.sent).toHaveLength(1); // queued until task-started
    socket.emit('task-started');
    expect(socket.sent[1]).toEqual(new Uint8Array([1, 2]));
    socket.emit('result-generated', { output: { sentence: { text: '明天早上' } } });
    socket.emit('result-generated', { output: { sentence: { text: '明天早上八点提醒我。', sentence_end: true } } });
    expect(texts).toEqual(['明天早上', '明天早上八点提醒我。']);
    expect(await stream.finish()).toBe('明天早上八点提醒我。顺便查一下校园卡余额。');
    expect(socket.json(2).header.action).toBe('finish-task');
    expect(socket.closed).toBe(true);
  });

  test('task-failed fails finish with the server message', async () => {
    const socket = new FakeSocket();
    const pending = dashscopeRealtime(config(socket), { onText: () => {} });
    socket.onopen?.();
    const stream = await pending;
    socket.emit('task-failed', {}, { error_code: 'InvalidApiKey', error_message: 'Invalid API-key provided.' });
    await expect(stream.finish()).rejects.toThrow('Invalid API-key provided.');
  });
});
