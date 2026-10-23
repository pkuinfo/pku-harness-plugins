import { definePlugin, defineTool, inputZod, LANGUAGE_REFERENCE, loadDocument, memoryKV, PluginDocError, runTool, type PublicFetch } from '@pku-harness/sdk';
import { z } from 'zod';

const filesSchema = z
  .record(z.string(), z.string())
  .refine((f) => typeof f['PLUGIN.md'] === 'string', 'files must include "PLUGIN.md"')
  .describe('the plugin folder as { "PLUGIN.md": "...", "tools/x.yaml": "..." }');

const load = (files: Record<string, string>) =>
  loadDocument(async (p) => {
    const text = files[p];
    if (text === undefined) throw new PluginDocError([`missing file ${p} (named in PLUGIN.md)`]);
    return text;
  });

/** Public HTTP for dry runs (the runner checks hosts against the draft's network list). */
const dryFetch: PublicFetch = async (req) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: ctrl.signal });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    return { status: res.status, url: res.url || req.url, headers, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Plugin management as tools. Listing is free; installing or removing a remote plugin asks the
 * user by default, and permissions themselves are only changed by the user in Settings.
 */
export const pluginsPlugin = definePlugin({
  id: 'plugins',
  name: '插件管理',
  description: '查看已安装的插件，安装或移除插件；和你一起编写新插件（PLUGIN.md）。',
  version: '0.3.0',
  i18n: {
    en: {
      name: 'Plugins',
      description: 'See installed plugins, install or remove plugins, and write new ones (PLUGIN.md) with the AI.',
      tools: {
        list: { title: 'View plugins' },
        installRemote: { title: 'Install remote plugin' },
        uninstall: { title: 'Remove remote plugin' },
        reference: { title: 'Plugin language reference' },
        validate: { title: 'Check a plugin' },
        tryTool: { title: 'Try a plugin tool' },
        source: { title: 'Read a plugin’s source' },
        install: { title: 'Install a plugin' },
      },
    },
  },
  icon: 'puzzle',
  core: true,
  instructions: `插件可以由你和用户一起写：一个插件就是一个 PLUGIN.md 文件夹（YAML 前言 + 给 AI 的说明 + tools/*.yaml），由 App 解释执行，不运行代码。
写插件的流程：plugins__reference 读语言参考 → 写出文件 → plugins__validate 直到没有问题 → 对只读工具用 plugins__tryTool 实际跑一次给用户看结果 → plugins__install 打开权限确认页，由用户决定安装。
用户贴出插件链接（GitHub 文件夹或 PLUGIN.md 链接）时，用 plugins__install { link } 打开确认页。改已有插件：plugins__source 读源码再改。`,
  scopes: [],
  defaultModes: { write: 'ask' },
  tools: {
    list: defineTool({
      title: '查看插件',
      description: 'Installed plugins with their tools, whether they are enabled, and their per-effect modes.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => ctx.services.registry.plugins(),
    }),
    installRemote: defineTool({
      title: '安装远程插件',
      description: 'Install a remote plugin from an MCP (Streamable HTTP) endpoint URL. Its tools become available after install.',
      input: z.object({
        url: z.string().url(),
        name: z.string().optional(),
        token: z.string().optional().describe('bearer token if the server requires one'),
      }),
      effect: 'write',
      execute: async (input, ctx) => ctx.services.remote.install(input),
    }),
    reference: defineTool({
      title: '插件语言参考',
      description: 'The plugin language (PLUGIN.md documents) in one page: manifest, steps, expressions, stdlib, abilities, limits, an example. Read it before writing or editing a plugin.',
      input: z.object({}),
      effect: 'read',
      execute: async () => LANGUAGE_REFERENCE,
    }),
    validate: defineTool({
      title: '检查插件',
      description: 'Validate a draft plugin folder. Returns { ok, id, tools, widgets, campus, network, abilities } or { ok: false, issues } with the file and step of each problem.',
      input: z.object({ files: filesSchema }),
      effect: 'read',
      execute: async ({ files }) => {
        try {
          const d = await load(files);
          return {
            ok: true,
            id: d.manifest.id,
            version: d.manifest.version,
            tools: Object.fromEntries(Object.entries(d.tools).map(([k, t]) => [k, t.effect])),
            widgets: Object.keys(d.widgets),
            campus: d.manifest.campus ?? [],
            network: d.manifest.network ?? [],
            abilities: d.manifest.abilities ?? [],
          };
        } catch (e) {
          if (e instanceof PluginDocError) return { ok: false, issues: e.issues };
          throw e;
        }
      },
    }),
    tryTool: defineTool({
      title: '试运行插件工具',
      description: 'Run one READ tool of a draft plugin for real (live requests, the user’s campus sessions for declared services, a throwaway store) without installing it. Use it to show the user real results before installing.',
      input: z.object({ files: filesSchema, tool: z.string(), input: z.record(z.string(), z.unknown()).optional() }),
      effect: 'read',
      untrusted: true,
      execute: async ({ files, tool, input }, ctx) => {
        const d = await load(files);
        const t = d.tools[tool];
        if (!t) throw new Error(`no tool '${tool}' (tools: ${Object.keys(d.tools).join(', ')})`);
        if (t.effect !== 'read') throw new Error(`only read tools can be tried before installing ('${tool}' is ${t.effect})`);
        const parsed = inputZod(t.input).parse(input ?? {}) as Record<string, unknown>;
        return runTool({ manifest: d.manifest, tools: d.tools, services: ctx.services, kv: memoryKV(), fetch: dryFetch, signal: ctx.signal }, tool, parsed);
      },
    }),
    source: defineTool({
      title: '读取插件源码',
      description: 'The files of an installed plugin document (PLUGIN.md and the files it names), to explain, fix or fork it. Built-in TypeScript plugins have no document.',
      input: z.object({ id: z.string() }),
      effect: 'read',
      execute: async ({ id }, ctx) => {
        const s = ctx.services.docs?.source(id);
        if (!s) throw new Error(`${id} 不是插件文档（PLUGIN.md），没有可读的源码`);
        return s;
      },
    }),
    install: defineTool({
      title: '安装插件',
      description: 'Open the app’s permission sheet for a plugin: a link (GitHub folder, PLUGIN.md URL) or a draft folder ({ files }). The user reviews what it can reach and decides there; this tool only opens the sheet.',
      input: z.object({ link: z.string().optional(), files: filesSchema.optional() }).refine((x) => !!x.link !== !!x.files, 'give either link or files'),
      effect: 'write',
      execute: async (input, ctx) => {
        if (!ctx.services.docs) throw new Error('这个 App 版本还不能安装插件文档');
        if (input.files) await load(input.files);
        await ctx.services.docs.review(input);
        return { opened: true, note: 'The permission sheet is open; the user installs from there.' };
      },
    }),
    uninstall: defineTool({
      title: '移除远程插件',
      description: 'Remove an installed remote plugin.',
      input: z.object({ id: z.string() }),
      effect: 'write',
      execute: async ({ id }, ctx) => {
        if (!ctx.services.remote.has(id)) throw new Error(`只能移除远程插件：${id}`);
        await ctx.services.remote.uninstall(id);
        return { removed: id };
      },
    }),
  },
});
