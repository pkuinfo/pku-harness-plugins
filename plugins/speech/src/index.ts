import { definePlugin } from '@pku-harness/sdk';

import { openAITranscribe } from './transcribe';

/**
 * Speech-to-text for the composer's voice input, with the user's own key. The recording goes
 * from the phone straight to the chosen service; nothing passes through our servers.
 */
export const speechPlugin = definePlugin({
  id: 'speech',
  name: '语音输入',
  description: '用你自己的语音识别服务把说的话转成文字。',
  version: '0.1.0',
  i18n: {
    en: {
      name: 'Voice input',
      description: 'Turn speech into text with your own speech-recognition service.',
      scopes: { '你选择的语音识别服务': 'The speech service you choose' },
      speech: {
        siliconflow: {
          name: 'SiliconFlow',
          description: 'SenseVoice and TeleSpeech, reachable in mainland China',
          credentialHint: 'An API key from cloud.siliconflow.cn',
          models: {
            'FunAudioLLM/SenseVoiceSmall': { name: 'SenseVoice', description: 'Fast; Mandarin, English, Cantonese, Japanese, Korean' },
            'TeleAI/TeleSpeechASR': { name: 'TeleSpeech', description: 'Stronger on Chinese dialects' },
          },
        },
        custom: {
          name: 'OpenAI-compatible',
          description: 'Any service with an /audio/transcriptions endpoint',
          credentialHint: 'The API key from your provider',
        },
      },
    },
  },
  requires: ['network'],
  icon: 'mic',
  scopes: ['你选择的语音识别服务'],
  tools: {},
  speech: {
    siliconflow: {
      name: '硅基流动',
      description: 'SenseVoice 与 TeleSpeech，国内可直接访问',
      defaultBaseURL: 'https://api.siliconflow.cn/v1',
      models: [
        { id: 'FunAudioLLM/SenseVoiceSmall', name: 'SenseVoice', description: '速度快；普通话、英语、粤语、日语、韩语' },
        { id: 'TeleAI/TeleSpeechASR', name: 'TeleSpeech', description: '方言识别更好' },
      ],
      defaultModel: 'FunAudioLLM/SenseVoiceSmall',
      credentialHint: '在 cloud.siliconflow.cn 创建的 API Key',
      keyURL: 'https://cloud.siliconflow.cn/account/ak',
      transcribe: openAITranscribe,
    },
    custom: {
      name: 'OpenAI 兼容',
      description: '任意提供 /audio/transcriptions 接口的服务',
      defaultBaseURL: 'https://api.openai.com/v1',
      editableBaseURL: true,
      models: [],
      defaultModel: 'gpt-4o-mini-transcribe',
      credentialHint: '服务商提供的 API Key',
      transcribe: openAITranscribe,
    },
  },
});
