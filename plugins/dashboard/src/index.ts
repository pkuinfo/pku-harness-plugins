import { bindingSchema, definePlugin, defineTool, specSchema, widgetSizeSchema, type HostServices, type Widget } from '@pku-harness/sdk';
import { z } from 'zod';

import { DashboardTab } from './ui/dashboard-tab';
import { Gallery } from './ui/gallery';

const view = (w: Widget) =>
  w.source
    ? { id: w.id, title: w.title, size: w.size, position: w.position, source: w.source }
    : { id: w.id, title: w.title, size: w.size, position: w.position, bindings: w.bindings, spec: w.spec };

async function place(services: HostServices, w: Widget, position?: number) {
  await services.widgets.put(w);
  if (position != null) {
    const ids = services.widgets.list().map((x) => x.id).filter((x) => x !== w.id);
    ids.splice(position, 0, w.id);
    await services.widgets.reorder(ids);
  }
}

function checkBindings(services: HostServices, bindings: Record<string, z.infer<typeof bindingSchema>>) {
  for (const [pointer, b] of Object.entries(bindings)) {
    if (!pointer.startsWith('/')) throw new Error(`绑定路径必须以 / 开头：${pointer}`);
    const entry = services.registry.tool(b.tool);
    if (!entry) throw new Error(`没有这个工具：${b.tool}`);
    if (entry.effect !== 'read') throw new Error(`看板只能绑定只读工具：${b.tool}`);
  }
}

/** Build and edit the Dashboard tab (docs/ARCHITECTURE.md §7). */
export const dashboardPlugin = definePlugin({
  id: 'dashboard',
  name: '看板',
  description: '由 AI 搭建、可随时修改的数据看板。',
  version: '0.3.0',
  i18n: {
    en: {
      name: 'Dashboard',
      description: 'A dashboard the AI builds for you and you can change any time.',
      tools: {
        list: { title: 'View dashboard' },
        sources: { title: 'Available data sources' },
        catalog: { title: 'Plugin widgets' },
        addPluginWidget: { title: 'Add plugin widget' },
        upsertWidget: { title: 'Add or edit widget' },
        removeWidget: { title: 'Remove widget' },
        reorder: { title: 'Reorder dashboard' },
      },
      screens: { home: { title: 'Dashboard' }, gallery: { title: 'Add widget' } },
    },
  },
  icon: 'dashboard',
  core: true,
  scopes: [],
  contributes: {
    screens: { home: { title: '看板', component: DashboardTab }, gallery: { title: '添加组件', component: Gallery, presentation: 'modal' } },
    tabs: [{ slot: 'dashboard', screen: 'home' }],
  },
  instructions: `用户想在看板上看到某些数字时：
- 先用 dashboard__catalog 看插件有没有现成的原生组件（如校园卡余额），有就用 dashboard__addPluginWidget 放上去，外观和刷新由插件负责。
- 没有合适的，再用 dashboard__upsertWidget 自己搭一个；修改时传入已有 id。
- spec 与 ui__render 相同（同一套组件），但看板组件不要放按钮表单，重点是数字：通常一个 Card 或 Column 里放 Stat / ListItem / Progress。
- 实时数据用 bindings：{ "/card": { tool: "wallet.cardBalance", path: "balance", ttlMinutes: 5 } }，然后在 props 里写 { "$state": "/card" }；文本可用 { "$template": "第 \${/today/semester/week} 周" }。
- size：sm 半宽小卡片（单个数字），md 全宽，lg 全宽重点卡片。
- 可绑定的数据源用 dashboard__sources 查看；只读工具都可以绑定。创建后看返回的 preview 确认数据正确。
- 刷新：数据超过 ttlMinutes 就会在用户打开看板、回到 App 时自动重新获取，看板可见时也会按 ttl 定时刷新，用户还可以下拉强制刷新。余额类 5–15 分钟，学期周次这类 60 分钟以上。`,
  tools: {
    list: defineTool({
      title: '查看看板',
      description: 'List dashboard widgets in display order, with their specs and bindings.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => ctx.services.widgets.list().map(view),
    }),
    sources: defineTool({
      title: '可用数据源',
      description: 'Data sources that widgets can bind to: plugin data sources and every read-only tool.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) =>
        ctx.services.registry
          .plugins()
          .filter((p) => p.enabled && !['ui', 'dashboard'].includes(p.id))
          .flatMap((p) => p.tools.filter((t) => t.effect === 'read').map((t) => ({ tool: t.id, title: t.title, plugin: p.name }))),
    }),
    catalog: defineTool({
      title: '插件组件',
      description: 'Native widgets shipped by enabled plugins (prefer these over building one). Each has sizes and an optional config JSON Schema.',
      input: z.object({}),
      effect: 'read',
      execute: async (_input, ctx) => ctx.services.widgets.catalog(),
    }),
    addPluginWidget: defineTool({
      title: '添加插件组件',
      description: 'Place a plugin-provided widget from dashboard__catalog on the dashboard, or update one when id is given.',
      input: z.object({
        id: z.string().optional().describe('existing widget id to replace'),
        plugin: z.string(),
        widget: z.string(),
        title: z.string().optional().describe('default: the widget\'s own title'),
        size: widgetSizeSchema.optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        position: z.number().int().min(0).optional().describe('0 = top; default end (or unchanged)'),
      }),
      effect: 'write',
      execute: async ({ id, plugin, widget, title, size, config, position }, ctx) => {
        const widgets = ctx.services.widgets;
        const entry = widgets.catalog().find((e) => e.plugin === plugin && e.widget === widget);
        if (!entry) throw new Error(`没有这个插件组件：${plugin}/${widget}（插件未安装或已关闭）`);
        if (size && !entry.sizes.includes(size)) throw new Error(`${entry.title} 只支持 ${entry.sizes.join(' / ')}`);
        const cur = id ? widgets.get(id) : undefined;
        if (id && !cur) throw new Error(`没有这个组件：${id}`);
        const now = Date.now();
        const w: Widget = {
          id: cur?.id ?? widgets.newId(),
          title: title ?? entry.title,
          size: size ?? cur?.size ?? entry.defaultSize,
          spec: {},
          bindings: {},
          source: { plugin, widget, config },
          position: cur?.position ?? widgets.list().length,
          createdAt: cur?.createdAt ?? now,
          updatedAt: now,
        };
        await place(ctx.services, w, position);
        return { saved: true, id: w.id, title: w.title, size: w.size };
      },
    }),
    upsertWidget: defineTool({
      title: '添加或修改看板组件',
      description: 'Create a widget, or replace an existing one when id is given. Returns the resolved data as preview.',
      input: z.object({
        id: z.string().optional().describe('existing widget id to replace'),
        title: z.string().min(1),
        size: widgetSizeSchema,
        spec: specSchema,
        bindings: z.record(z.string(), bindingSchema).optional(),
        position: z.number().int().min(0).optional().describe('0 = top; default end (or unchanged)'),
      }),
      effect: 'write',
      execute: async ({ id, title, size, spec, bindings = {}, position }, ctx) => {
        const widgets = ctx.services.widgets;
        const checked = ctx.services.genui.checkSpec(spec);
        if (!checked.ok) return { saved: false, issues: checked.issues };
        checkBindings(ctx.services, bindings);
        const cur = id ? widgets.get(id) : undefined;
        if (id && !cur) throw new Error(`没有这个组件：${id}`);
        const now = Date.now();
        const w: Widget = {
          id: cur?.id ?? widgets.newId(),
          title,
          size,
          spec: checked.spec as unknown as Record<string, unknown>,
          bindings,
          position: cur?.position ?? widgets.list().length,
          createdAt: cur?.createdAt ?? now,
          updatedAt: now,
        };
        await place(ctx.services, w, position);
        let preview: unknown;
        try {
          preview = await widgets.preview(w);
        } catch (e) {
          preview = { error: e instanceof Error ? e.message : String(e) };
        }
        return { saved: true, id: w.id, preview };
      },
    }),
    removeWidget: defineTool({
      title: '移除看板组件',
      description: 'Remove a widget from the dashboard.',
      input: z.object({ id: z.string() }),
      effect: 'write',
      execute: async ({ id }, ctx) => {
        const w = ctx.services.widgets.get(id);
        if (!w) throw new Error(`没有这个组件：${id}`);
        await ctx.services.widgets.remove(id);
        return { removed: w.title };
      },
    }),
    reorder: defineTool({
      title: '调整看板顺序',
      description: 'Set the widget order by listing ids from top to bottom.',
      input: z.object({ ids: z.array(z.string()) }),
      effect: 'write',
      execute: async ({ ids }, ctx) => {
        await ctx.services.widgets.reorder(ids);
        return ctx.services.widgets.list().map((w) => ({ id: w.id, title: w.title }));
      },
    }),
  },
});
