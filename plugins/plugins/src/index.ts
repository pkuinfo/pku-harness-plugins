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
        search: { title: 'Find a plugin' },
        use: { title: 'Use a plugin' },
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
  instructions: `你一开始只带着核心工具（设置、文件、日程、提醒、看板、记忆、界面）。其他能力都在插件里，按需加载：
- 用户要的事现有工具做不到时，先看 <可加载插件> 里有没有合适的，有就 plugins__use { ids } 加载，它会返回该插件的用法，之后它的工具就能用了；没有就 plugins__search { query } 搜索已安装插件和社区插件市场。
- 搜到的社区插件用 plugins__install { link } 打开确认页，由用户决定是否安装；安装后再 plugins__use 加载。用户贴出插件链接（GitHub 文件夹或 PLUGIN.md 链接）时也用 plugins__install { link }。
- 都没有时，可以和用户一起写一个新插件。写插件、改插件、卸载插件或安装远程（MCP）插件时，先 plugins__use { ids: ["plugins"] } 加载编写工具，再按 plugins__reference 的说明做。
- 不要向用户罗列你有哪些插件或能力；用户问什么就做什么，需要时自己去找。`,
  scopes: [],
  defaultModes: { write: 'ask' },
  tools: {
    search: defineTool({
      title: '查找插件',
      description:
        'Find plugins for what the user needs: installed ones (with whether they are loaded, enabled and usable here) and community marketplace plugins (with the link or endpoint to install). Search by need, e.g. "空闲教室", "card balance", "图书馆座位". Then plugins__use an installed one, or plugins__install a marketplace one.',
      input: z.object({ query: z.string().min(1).max(80).describe('what the user needs, in a few words (Chinese or English)') }),
      effect: 'read',
      execute: async ({ query }, ctx) => {
        const q = query.toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        const score = (text: string) => words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0) + (text.includes(q) ? 2 : 0);
        const installed = ctx.services.registry
          .plugins()
          .map((p) => ctx.services.registry.describe(p.id))
          .filter((d): d is NonNullable<typeof d> => !!d && d.tools.length > 0)
          .map((d) => ({ d, n: score(`${d.id} ${d.name} ${d.description} ${d.tools.map((t) => t.title).join(' ')}`.toLowerCase()) }))
          .filter((x) => x.n > 0)
          .sort((a, b) => b.n - a.n)
          .slice(0, 8)
          .map(({ d }) => ({ id: d.id, name: d.name, description: d.description, core: d.core, enabled: d.enabled, unavailable: d.unavailable }));
        const market = await ctx.services.registry.marketplace(query).catch(() => []);
        return { installed, marketplace: market.filter((m) => !m.installed).slice(0, 8) };
      },
    }),
    use: defineTool({
      title: '加载插件',
      description:
        'Load installed plugins into this chat by id (from <可加载插件> or plugins__search). Returns each plugin’s instructions and tools; from the next step its tools are available. A plugin that is switched off is not loaded: ask the user, then turn it on with settings__change plugin.<id>.enabled.',
      input: z.object({ ids: z.array(z.string().min(1)).min(1).max(5).describe('plugin ids') }),
      effect: 'read',
      execute: async ({ ids }, ctx) => ({
        loaded: ids.map((id) => {
          const d = ctx.services.registry.describe(id);
          if (!d) return { id, error: 'No installed plugin with this id; use plugins__search.' };
          if (!d.enabled) return { id, error: `Switched off. Ask the user, then settings__change plugin.${id}.enabled = true.` };
          if (d.unavailable) return { id, error: `Not usable on this device: ${d.unavailable}` };
          return { id, name: d.name, instructions: d.instructions ?? '', tools: d.tools };
        }),
      }),
    }),
    list: defineTool({
      title: '查看插件',
      description: 'Installed plugins with their tools, whether they are enabled, and their per-effect modes.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => ctx.services.registry.plugins(),
    }),
    installRemote: defineTool({
      onDemand: true,
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
      onDemand: true,
      title: '插件语言参考',
      description: 'Start here when writing a plugin with the user. A plugin is a folder: PLUGIN.md (YAML front matter + instructions for the AI) and tools/*.yaml, interpreted by the app (no code runs). Workflow: read this reference, write the files, plugins__validate until there are no issues, run each read tool once with plugins__tryTool and show the user the result, then plugins__install { files } to open the permission sheet; the user decides. To change an installed plugin, read it with plugins__source first. The plugin language (PLUGIN.md documents) in one page: manifest, steps, expressions, stdlib, abilities, limits, an example. Read it before writing or editing a plugin.',
      input: z.object({}),
      effect: 'read',
      execute: async () => LANGUAGE_REFERENCE,
    }),
    validate: defineTool({
      onDemand: true,
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
      onDemand: true,
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
      onDemand: true,
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
      onDemand: true,
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
