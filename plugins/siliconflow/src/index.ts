import { definePlugin, openAITranscribe } from '@pku-harness/sdk';

/**
 * SiliconFlow (硅基流动, api.siliconflow.cn) speech-to-text for voice input, with the user's own
 * key: POST /v1/audio/transcriptions (file + model → { text }), files up to 1 h / 50 MB
 * (api-docs.siliconflow.cn/docs/api/audio-transcriptions-post). It takes finished recordings
 * only, so the host sends the audio in pieces cut at pauses while the user talks.
 */
export const siliconflowPlugin = definePlugin({
  id: 'siliconflow',
  name: '硅基流动',
  description: '用硅基流动的语音识别把语音输入转成文字（你自己的 API Key）。',
  version: '0.1.0',
  i18n: {
    en: {
      name: 'SiliconFlow',
      description: 'Voice input transcribed by SiliconFlow’s speech recognition (your own API key).',
      scopes: { 'api.siliconflow.cn': 'api.siliconflow.cn' },
      speech: {
        asr: {
          name: 'SiliconFlow',
          description: 'SenseVoice and TeleSpeech, reachable in mainland China; text arrives in phrases',
          credentialHint: 'An API key from cloud.siliconflow.cn',
          models: {
            'FunAudioLLM/SenseVoiceSmall': { name: 'SenseVoice', description: 'Mandarin, English, Cantonese, Japanese, Korean' },
            'TeleAI/TeleSpeechASR': { name: 'TeleSpeech', description: 'Stronger on Chinese dialects' },
          },
        },
      },
    },
  },
  requires: ['network'],
  icon: 'mic',
  scopes: ['api.siliconflow.cn'],
  tools: {},
  speech: {
    asr: {
      name: '硅基流动',
      description: 'SenseVoice 与 TeleSpeech，国内可直接访问；文字按句子出现',
      defaultBaseURL: 'https://api.siliconflow.cn/v1',
      models: [
        { id: 'FunAudioLLM/SenseVoiceSmall', name: 'SenseVoice', description: '普通话、英语、粤语、日语、韩语' },
        { id: 'TeleAI/TeleSpeechASR', name: 'TeleSpeech', description: '方言识别更好' },
      ],
      defaultModel: 'FunAudioLLM/SenseVoiceSmall',
      credentialHint: '在 cloud.siliconflow.cn 创建的 API Key',
      keyURL: 'https://cloud.siliconflow.cn/account/ak',
      transcribe: openAITranscribe,
    },
  },
});
