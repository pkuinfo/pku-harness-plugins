import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderConfig, ProviderModel } from '@pku-harness/sdk';

/** AI SDK model for any OpenAI-compatible Chat Completions endpoint, streaming via the host's fetch. */
export function openAICompatibleModel(name: string, config: ProviderConfig) {
  const provider = createOpenAICompatible({
    name,
    baseURL: config.baseURL,
    apiKey: config.credential,
    fetch: config.fetch,
    includeUsage: true,
  });
  return provider.chatModel(config.model);
}

/** GET {baseURL}/models (OpenAI list format). */
export async function listOpenAIModels(config: ProviderConfig): Promise<ProviderModel[]> {
  const res = await config.fetch(`${config.baseURL.replace(/\/+$/, '')}/models`, {
    headers: config.credential ? { Authorization: `Bearer ${config.credential}` } : {},
  });
  if (!res.ok) throw new Error(`模型列表请求失败：HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => ({ id: m.id }));
}
