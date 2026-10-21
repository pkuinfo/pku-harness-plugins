import { defineStrings, plural } from '@pku-harness/sdk';

export const strings = defineStrings({
  'zh-Hans': {
    title: 'AI 记忆',
    subtitle: 'Memory',
    kinds: { preference: '偏好', fact: '信息', routine: '习惯', person: '人', other: '其他' } as Record<string, string>,
    intro: 'AI 会记下你提到的长期信息，回答时参考相关的几条。记忆只保存在这台手机上；置顶的记忆每次都会带上。',
    loadFailed: '读取失败',
    empty: '还没有记忆',
    emptyHint: '在对话里说「记住我是信科 2024 级的」，AI 就会记下来。',
    count: (n: number) => `${n} 条`,
    pinned: '置顶',
    unpin: '取消置顶',
    pin: '置顶',
    remove: '删除这条记忆',
  },
  en: {
    title: 'AI memory',
    subtitle: '',
    kinds: { preference: 'Preference', fact: 'Fact', routine: 'Habit', person: 'Person', other: 'Other' } as Record<string, string>,
    intro: 'The AI notes down lasting things you mention and draws on the relevant ones when it answers. Memories stay on this phone; pinned ones are always included.',
    loadFailed: 'Couldn’t load',
    empty: 'No memories yet',
    emptyHint: 'Say “Remember that I’m in EECS, class of 2024” in chat and the AI will note it down.',
    count: (n: number) => plural(n, 'memory', 'memories'),
    pinned: 'Pinned',
    unpin: 'Unpin',
    pin: 'Pin',
    remove: 'Delete this memory',
  },
});
