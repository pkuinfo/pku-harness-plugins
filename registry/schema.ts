import { z } from 'zod';

/**
 * Marketplace registry format. The app's 插件市场 reads registry.json from this repo.
 * Built-in plugins are listed too: every plugin is equal; "builtin" only means it ships in the
 * app binary, "remote" means it runs behind an MCP (Streamable HTTP) endpoint.
 */
export const capability = z.enum(['network', 'campus-network', 'campus-session', 'notifications', 'background', 'shell', 'filesystem', 'cloud', 'ongoing']);

/** PKU Harness Cloud services (docs/CLOUD.md §2.2, SDK `CloudService`). */
export const cloudService = z.enum(['store', 'channels', 'push', 'files', 'functions']);

/**
 * What a plugin sends to PKU Harness Cloud, so the market can show "uses cloud" before install.
 * Mirrors the plugin's `PluginDef.cloud` (checked for built-ins by plugins/registry-cloud.test.ts).
 */
export const registryCloud = z.object({
  uses: z.array(cloudService),
  e2e: z.boolean(),
  /** Plain-language lines: exactly what leaves the device. Required (zh) when `uses` is non-empty. */
  disclosure: z.object({ zh: z.array(z.string()), en: z.array(z.string()).optional() }),
  backend: z.discriminatedUnion('kind', [z.object({ kind: z.literal('provider') }), z.object({ kind: z.literal('external'), url: z.string().url() })]).optional(),
});

export const registryEntry = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  name: z.string().min(1),
  description: z.string().min(4).max(200),
  author: z.string().min(1),
  /** Where the source lives (a folder in this repo, or an external repo). */
  source: z.string().url(),
  kind: z.enum(['builtin', 'remote']),
  /** Remote plugins: public MCP endpoint, or null when users self-host from `source`. */
  endpoint: z.string().url().nullable().optional(),
  auth: z.enum(['none', 'bearer']).default('none'),
  icon: z.string().optional(),
  requires: z.array(capability).default([]),
  scopes: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  cloud: registryCloud.optional(),
  /** Reviewed by maintainers (built-ins are). */
  verified: z.boolean().default(false),
});

export const registry = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  plugins: z.array(registryEntry),
});

export type RegistryEntry = z.infer<typeof registryEntry>;
export type RegistryCloud = z.infer<typeof registryCloud>;
export type Registry = z.infer<typeof registry>;

/** The consent sheet shows `disclosure`: a plugin that sends anything must say what, in plain words. */
export function cloudIssues(c: RegistryCloud): string[] {
  const out: string[] = [];
  if (new Set(c.uses).size !== c.uses.length) out.push('cloud.uses has duplicates');
  if (c.uses.length > 0 && c.disclosure.zh.length === 0) out.push('cloud.uses is non-empty, so cloud.disclosure.zh must say what leaves the device');
  for (const [lang, lines] of Object.entries(c.disclosure)) if (lines?.some((l) => !l.trim())) out.push(`cloud.disclosure.${lang} has an empty line`);
  if (c.disclosure.en && c.disclosure.en.length !== c.disclosure.zh.length) out.push('cloud.disclosure.en must translate every zh line');
  if (c.backend?.kind === 'external' && !c.backend.url.startsWith('https://')) out.push('cloud.backend.url must be https');
  return out;
}
