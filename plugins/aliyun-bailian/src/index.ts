import { definePlugin } from '@pku-harness/sdk';

import { dashscopeRealtime } from './realtime';

/**
 * Alibaba Cloud Bailian (阿里云百炼) realtime speech recognition for voice input, with the user's own
 * key: text appears while the user talks. Endpoint: 华北2（北京） DashScope duplex WebSocket. Fun-ASR
 * realtime is the default (fastest and accurate on campus place names in our test); Paraformer
 * realtime v2 is cheaper.
 */
export const aliyunBailianPlugin = definePlugin({
  id: 'aliyun-bailian',
  name: '阿里云百炼',
  description: '用阿里云百炼的实时语音识别，说话时文字同步出现（你自己的 API Key）。',
  version: '0.1.0',
  i18n: {
    en: {
      name: 'Alibaba Cloud Bailian',
      description: 'Voice input with Bailian’s realtime speech recognition: text appears while you talk (your own API key).',
      scopes: { 'dashscope.aliyuncs.com（华北2 北京）': 'dashscope.aliyuncs.com (China North 2, Beijing)' },
      speech: {
        realtime: {
          name: 'Alibaba Cloud Bailian (live)',
          description: 'Realtime speech recognition, Beijing region; text appears while you talk',
          credentialHint: 'An API key for the Beijing region from the Bailian console',
          models: {
            'fun-asr-realtime': { name: 'Fun-ASR', description: 'Fastest and most accurate: ¥0.00033/s' },
            'paraformer-realtime-v2': { name: 'Paraformer v2', description: 'Cheaper: ¥0.00024/s; Chinese incl. Cantonese, English, Japanese, Korean' },
          },
        },
      },
    },
  },
  requires: ['network'],
  icon: 'mic',
  scopes: ['dashscope.aliyuncs.com（华北2 北京）'],
  tools: {},
  speech: {
    realtime: {
      name: '阿里云百炼（实时）',
      description: '实时语音识别，华北2（北京）；说话时文字同步出现',
      defaultBaseURL: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
      models: [
        { id: 'fun-asr-realtime', name: 'Fun-ASR', description: '最快、最准：¥0.00033/秒' },
        { id: 'paraformer-realtime-v2', name: 'Paraformer v2', description: '更便宜：¥0.00024/秒；中文（含粤语）、英语、日语、韩语' },
      ],
      defaultModel: 'fun-asr-realtime',
      credentialHint: '百炼控制台中华北2（北京）地域的 API Key',
      keyURL: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
      stream: dashscopeRealtime,
    },
  },
});
