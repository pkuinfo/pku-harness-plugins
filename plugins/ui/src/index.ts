import { definePlugin, defineTool, specSchema } from '@pku-harness/sdk';
import { z } from 'zod';

/** Lets the agent render native UI in the conversation using the host's component catalog. */
export const uiPlugin = definePlugin({
  id: 'ui',
  name: '界面生成',
  description: '让 AI 在对话里生成原生界面：表单、选择器、数据卡片。',
  version: '0.2.0',
  i18n: {
    en: {
      name: 'Generative UI',
      description: 'Lets the AI build native UI in the chat: forms, pickers and data cards.',
      tools: { render: { title: 'Show UI in chat' } },
    },
  },
  icon: 'wand',
  core: true,
  scopes: [],
  tools: {
    render: defineTool({
      title: '在对话中显示界面',
      description: (services) => `Show a native UI in the chat, e.g. a form to collect input, a choice list, or a card summarising data.
Spec format: { root, elements: { [id]: { type, props, children?: [ids], on?: { press: { action, params } } } }, state? }.
Every prop listed for a component must be present; use null when unused.
Bind inputs with { "$bindState": "/form/<field>" }. A Button with on.press { "action": "submit", "params": { "label": null } } sends /form back to you as the user's next message.
Components:
${services.genui.describeCatalog()}`,
      input: z.object({ spec: specSchema }),
      effect: 'read',
      execute: async ({ spec }, ctx) => {
        const r = ctx.services.genui.checkSpec(spec);
        return r.ok ? { shown: true } : { shown: false, issues: r.issues };
      },
    }),
  },
});
