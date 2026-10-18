import { z } from 'zod';

/**
 * Marketplace registry format. The app's 插件市场 reads registry.json from this repo.
 * Built-in plugins are listed too: every plugin is equal; "builtin" only means it ships in the
 * app binary, "remote" means it runs behind an MCP (Streamable HTTP) endpoint.
 */
export const capability = z.enum(['network', 'campus-network', 'campus-session', 'notifications', 'background', 'shell', 'filesystem']);

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
  /** Reviewed by maintainers (built-ins are). */
  verified: z.boolean().default(false),
});

export const registry = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  plugins: z.array(registryEntry),
});

export type RegistryEntry = z.infer<typeof registryEntry>;
export type Registry = z.infer<typeof registry>;
