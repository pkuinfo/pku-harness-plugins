import { definePlugin } from '@pku-harness/sdk';

import { listOpenAIModels, openAICompatibleModel } from './model';

/**
 * DeepSeek, the default model provider. Catalog follows DeepSeek Harness
 * (`packages/llm/llm-deepseek/src/models.ts`); the live `/models` listing wins when available.
 * An `account` provider (DeepSeek sign-in, like `llm-deepseek-account`) can be added here.
 */
export const deepseekPlugin = definePlugin({
  id: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek 官方 API（默认 AI 服务）。',
  version: '0.2.0',
  i18n: {
    en: {
      name: 'DeepSeek',
      description: 'The official DeepSeek API (the default AI service).',
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
  tools: {},
  providers: {
    api: {
      name: 'DeepSeek',
      description: '使用 DeepSeek 开放平台的 API Key',
      auth: 'apiKey',
      defaultBaseURL: 'https://api.deepseek.com',
      models: [
        // contextWindow / inputModalities from DeepSeek Harness llm-deepseek models.ts + defaults.ts.
        { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', description: '快速、经济，日常任务', contextWindow: 1_000_000, inputModalities: ['text', 'image'] },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: '更强的推理与复杂任务', contextWindow: 1_000_000, inputModalities: ['text'] },
      ],
      defaultModel: 'deepseek-flash',
      credentialHint: '在 platform.deepseek.com 的 API Keys 页面创建',
      listModels: listOpenAIModels,
      createModel: (config) => openAICompatibleModel('deepseek', config),
    },
  },
});
