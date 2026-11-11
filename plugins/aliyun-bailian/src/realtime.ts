import { cleanTranscript, type SpeechConfig, type SpeechStream, type SpeechStreamHandlers } from '@pku-harness/sdk';

/**
 * DashScope realtime speech recognition (Paraformer / Fun-ASR realtime) over the duplex WebSocket
 * at /api-ws/v1/inference: `run-task` (16 kHz PCM) → `task-started` → binary audio frames while the
 * user talks → `finish-task`. The server sends `result-generated` with `output.sentence`
 * ({ text, sentence_end }) as each sentence grows, then `task-finished` (or `task-failed`).
 */

/** How long `finish` waits for `task-finished` before giving up. */
const FINISH_TIMEOUT_MS = 10_000;

type Sentence = { begin_time?: number; text?: string; sentence_end?: boolean; heartbeat?: boolean };
type ServerEvent = {
  header?: { event?: string; error_code?: string; error_message?: string };
  payload?: { output?: { sentence?: Sentence } };
};

/** Sentences in order (keyed by their start time); a growing sentence replaces its earlier text. */
export class Transcript {
  private done: string[] = [];
  private current = '';

  apply(s: Sentence): boolean {
    if (s.heartbeat || s.text === undefined) return false;
    if (s.sentence_end) {
      this.done.push(s.text);
      this.current = '';
    } else this.current = s.text;
    return true;
  }

  toString() {
    return cleanTranscript(this.done.join('') + this.current);
  }
}

const taskId = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/** base64 → bytes (Hermes has atob). */
function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function dashscopeRealtime(config: SpeechConfig, handlers: SpeechStreamHandlers): Promise<SpeechStream> {
  const ws = config.webSocket(config.baseURL.replace(/\/+$/, ''), config.credential ? { Authorization: `Bearer ${config.credential}` } : {});
  const task = taskId();
  const transcript = new Transcript();
  // Audio captured before the task started waits here.
  const queued: Uint8Array[] = [];
  let started = false;
  let failure: Error | null = null;
  let finished: ((text: string) => void) | null = null;
  let failed: ((e: Error) => void) | null = null;

  const fail = (e: Error) => {
    failure ??= e;
    failed?.(e);
  };
  const control = (action: 'run-task' | 'finish-task', payload: Record<string, unknown>) =>
    ws.send(JSON.stringify({ header: { action, task_id: task, streaming: 'duplex' }, payload }));

  return new Promise<SpeechStream>((resolve, reject) => {
    ws.onopen = () => {
      control('run-task', { task_group: 'audio', task: 'asr', function: 'recognition', model: config.model, parameters: { format: 'pcm', sample_rate: 16_000 }, input: {} });
      resolve(stream);
    };
    ws.onmessage = (m) => {
      let e: ServerEvent;
      try {
        e = JSON.parse(String(m.data)) as ServerEvent;
      } catch {
        return;
      }
      switch (e.header?.event) {
        case 'task-started':
          started = true;
          for (const chunk of queued.splice(0)) ws.send(chunk);
          break;
        case 'result-generated': {
          const s = e.payload?.output?.sentence;
          if (s && transcript.apply(s)) handlers.onText(transcript.toString());
          break;
        }
        case 'task-finished':
          finished?.(transcript.toString());
          break;
        case 'task-failed':
          fail(new Error(e.header.error_message || e.header.error_code || 'Speech recognition failed'));
          break;
      }
    };
    ws.onerror = () => {
      const e = new Error('Could not reach the speech service');
      reject(e);
      fail(e);
    };
    ws.onclose = (c) => {
      const e = new Error(c.reason || `The speech service closed the connection (${c.code})`);
      reject(e);
      fail(e);
    };

    const stream: SpeechStream = {
      send: (pcm) => {
        const chunk = bytes(pcm);
        if (started) ws.send(chunk);
        else queued.push(chunk);
      },
      finish: () =>
        new Promise<string>((done, error) => {
          if (failure) return error(failure);
          const timer = setTimeout(() => {
            error(new Error('The speech service did not finish in time'));
            ws.close();
          }, FINISH_TIMEOUT_MS);
          finished = (text) => {
            clearTimeout(timer);
            ws.close();
            done(text);
          };
          failed = (e) => {
            clearTimeout(timer);
            ws.close();
            error(e);
          };
          const send = () => control('finish-task', { input: {} });
          // Audio still queued behind a slow task start goes first.
          if (started) send();
          else {
            const wait = setInterval(() => {
              if (!started && !failure) return;
              clearInterval(wait);
              if (started) send();
            }, 50);
          }
        }),
      cancel: () => {
        finished = failed = null;
        ws.close();
      },
    };
  });
}
