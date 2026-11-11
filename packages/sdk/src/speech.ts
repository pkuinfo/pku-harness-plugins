import type { SpeechAudio, SpeechConfig } from './plugin';

/** SenseVoice-style control tokens (`<|zh|>`, `<|NEUTRAL|>`, `<|Speech|>`) some services leave in the text. */
const CONTROL_TOKENS = /<\|[^|>]*\|>/g;

/** Text as the composer should receive it: control tokens dropped, whitespace trimmed. */
export function cleanTranscript(text: string): string {
  return text.replace(CONTROL_TOKENS, '').replace(/[ \t]+\n/g, '\n').trim();
}

/** The provider's message from an error body (`{ error: { message } }`, `{ message }`, or plain text). */
export function speechErrorMessage(status: number, body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const message = typeof json.error === 'string' ? json.error : (json.error?.message ?? json.message);
    if (message) return `${status}: ${message}`;
  } catch {
    // not JSON
  }
  return `${status}: ${body.slice(0, 200) || 'request failed'}`;
}

/**
 * OpenAI-style `POST {baseURL}/audio/transcriptions` (multipart: file + model) → `{ text }`.
 * SiliconFlow, OpenAI, Groq and most compatible services take this shape.
 */
export async function openAITranscribe(config: SpeechConfig, audio: SpeechAudio, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append('file', audio.file, audio.name);
  form.append('model', config.model);
  const res = await config.fetch(`${config.baseURL.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: config.credential ? { Authorization: `Bearer ${config.credential}` } : undefined,
    body: form,
    signal,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(speechErrorMessage(res.status, body));
  let text: unknown;
  try {
    text = (JSON.parse(body) as { text?: unknown }).text;
  } catch {
    text = body;
  }
  if (typeof text !== 'string') throw new Error('The speech service returned no text');
  return cleanTranscript(text);
}
