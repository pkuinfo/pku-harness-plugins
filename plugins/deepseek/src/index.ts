import { definePlugin } from '@pku-harness/sdk';

import { fetchBalance, PRICING } from './balance';
import { listOpenAIModels, openAICompatibleModel } from './model';
import { deepseekOcr, deepseekTranscribe, webTools } from './tools';

/**
 * DeepSeek, the default model provider. Catalog follows DeepSeek Harness
 * (`packages/llm/llm-deepseek/src/models.ts`); the live `/models` listing wins when available.
 * An `account` provider (DeepSeek sign-in, like `llm-deepseek-account`) can be added here.
 * With the same key: voice input (speech recognition), web search and page reading for the agent,
 * and OCR for scanned documents (./tools.ts).
 */
export const deepseekPlugin = definePlugin({
  id: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek 官方 API（默认 AI 服务），同一个 Key 还可用于语音输入、联网搜索和扫描件识别。',
  version: '0.4.0',
  i18n: {
    en: {
      name: 'DeepSeek',
      description: 'The official DeepSeek API (the default AI service). The same key also covers voice input, web search and scanned-document recognition.',
      tools: {
        web_search: { title: 'Search the web' },
        web_read: { title: 'Read a web page' },
      },
      speech: {
        asr: {
          name: 'DeepSeek',
          description: 'Uses your DeepSeek API key, no extra key; text arrives in phrases',
          models: { asr: { name: 'DeepSeek speech recognition', description: 'Detects the language (Mandarin, Cantonese, English and more)' } },
        },
      },
      providers: {
        api: {
          name: 'DeepSeek',
          description: 'Use an API key from the DeepSeek platform',
          credentialHint: 'Create one under API Keys at platform.deepseek.com',
          models: {
            'deepseek-flash': { description: 'Fast and affordable, for everyday tasks' },
            'deepseek-v4-pro': { description: 'Stronger reasoning for complex tasks' },
          },
        },
      },
    },
  },
  requires: ['network'],
  icon: 'sparkles',
  scopes: ['api.deepseek.com'],
  tools: webTools,
  providers: {
    api: {
      name: 'DeepSeek',
      description: '使用 DeepSeek 开放平台的 API Key',
      auth: 'apiKey',
      defaultBaseURL: 'https://api.deepseek.com',
      models: [
        // pricing: ./balance.ts (official price page). contextWindow / inputModalities from DeepSeek Harness llm-deepseek models.ts + defaults.ts.
        { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', description: '快速、经济，日常任务', contextWindow: 1_000_000, inputModalities: ['text', 'image'], pricing: PRICING['deepseek-flash'] },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: '更强的推理与复杂任务', contextWindow: 1_000_000, inputModalities: ['text'], pricing: PRICING['deepseek-v4-pro'] },
      ],
      defaultModel: 'deepseek-flash',
      // api-docs.deepseek.com/guides/thinking_mode: reasoning_effort low | high | max; default high.
      efforts: ['low', 'high', 'max'],
      credentialHint: '在 platform.deepseek.com 的 API Keys 页面创建',
      listModels: listOpenAIModels,
      balance: fetchBalance,
      createModel: (config) => openAICompatibleModel('deepseek', config),
    },
  },
  speech: {
    asr: {
      name: 'DeepSeek',
      description: '使用你的 DeepSeek API Key，无需另外申请；文字按句子出现',
      defaultBaseURL: 'https://api.deepseek.com',
      // The API takes no model; one entry so the host has something to show and select.
      models: [{ id: 'asr', name: 'DeepSeek 语音识别', description: '自动识别语言（普通话、粤语、英语等）' }],
      defaultModel: 'asr',
      credentialFrom: 'api',
      transcribe: deepseekTranscribe,
    },
  },
  ocr: { ocr: deepseekOcr },
});
