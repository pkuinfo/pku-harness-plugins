import { z } from 'zod';

import { serverSchema } from './server-schema';

/**
 * Schemas of a plugin document (docs/PLUGIN-LANGUAGE.md §4–§5): the `PLUGIN.md` frontmatter and
 * tool files. The website's marketplace scanner mirrors `manifestSchema`. Steps are validated
 * structurally in `validate.ts`, which gives line-level messages zod can't.
 */

export const SPEC_VERSION = 1;

export const pluginIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'lowercase letters, digits and dashes, 2–41 characters');
export const toolNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'letters, digits and _, starting with a letter');
const effectSchema = z.enum(['read', 'write', 'money', 'public']);
const modeSchema = z.enum(['auto', 'ask', 'off']);
const durationSchema = z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d+)?\s*(ms|s|m|h|d)$/, 'like 30s, 5m, 1h or 1d')]);
/** A file path relative to PLUGIN.md: no scheme, no `..`, no leading slash. */
const relPathSchema = z
  .string()
  .min(1)
  .refine((p) => !/^[a-z]+:|^\/|(^|\/)\.\.(\/|$)|\\/.test(p), 'a relative path inside the plugin folder');

export const capabilitySchema = z.enum(['network', 'campus-network', 'campus-session', 'notifications', 'background', 'cloud', 'ongoing']);
export const abilitySchema = z.enum(['verify', 'otp', 'todos', 'timetable', 'scheduler', 'browser', 'campusPage', 'sms', 'files', 'crypto', 'cloud']);
export type Ability = z.infer<typeof abilitySchema>;

/** An input field of a tool (compiled to zod). */
export type FieldDef = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  enum?: (string | number)[];
  default?: unknown;
  optional?: boolean;
  description?: string;
  min?: number;
  max?: number;
  pattern?: string;
  items?: FieldDef;
};
export const fieldSchema: z.ZodType<FieldDef> = z.lazy(() =>
  z
    .object({
      type: z.enum(['string', 'number', 'integer', 'boolean', 'array', 'object']).optional(),
      enum: z.array(z.union([z.string(), z.number()])).min(1).optional(),
      default: z.unknown().optional(),
      optional: z.boolean().optional(),
      description: z.string().max(500).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().max(300).optional(),
      items: fieldSchema.optional(),
    })
    .strict(),
);

/** A step (§6). Shape is checked in validate.ts. */
export const stepSchema = z.record(z.string(), z.unknown());
export type StepDoc = Record<string, unknown>;

export const toolSchema = z
  .object({
    title: z.string().min(1).max(60),
    description: z.string().min(4).max(2000),
    effect: effectSchema,
    untrusted: z.boolean().optional(),
    userOnly: z.boolean().optional(),
    input: z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/), fieldSchema).optional(),
    constants: z.record(z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/), z.unknown()).optional(),
    functions: z.record(z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/), z.string()).optional(),
    steps: z.array(stepSchema).max(100).optional(),
    return: z.unknown().optional(),
  })
  .strict();
export type ToolDoc = z.infer<typeof toolSchema>;

const i18nToolSchema = z.object({ title: z.string() }).partial();
export const translationSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    tools: z.record(z.string(), i18nToolSchema),
    widgets: z.record(z.string(), z.object({ title: z.string(), description: z.string() }).partial()),
    screens: z.record(z.string(), z.object({ title: z.string() }).partial()),
    settings: z.record(z.string(), z.object({ title: z.string(), subtitle: z.string() }).partial()),
    commands: z.record(z.string(), z.object({ description: z.string(), argHint: z.string(), aliases: z.array(z.string()), prompt: z.string() }).partial()),
    dataSources: z.record(z.string(), z.object({ title: z.string() }).partial()),
  })
  .partial();

export const manifestSchema = z
  .object({
    spec: z.literal(SPEC_VERSION),
    id: pluginIdSchema,
    name: z.string().min(1).max(40),
    description: z.string().min(4).max(200),
    version: z.string().regex(/^\d+\.\d+\.\d+([-+][\w.]+)?$/, 'semver, like 1.0.0'),
    author: z.string().min(1).max(80),
    icon: z.string().max(40).optional(),
    homepage: z.string().url().optional(),
    minApp: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    requires: z.array(capabilitySchema).optional(),
    campus: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,30}$/)).optional(),
    network: z.array(z.string().regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'a host like example.com or *.example.com')).optional(),
    abilities: z.array(abilitySchema).optional(),
    tools: z.record(toolNameSchema, z.union([relPathSchema, toolSchema])).optional(),
    dataSources: z.record(z.string(), z.object({ title: z.string().optional(), tool: toolNameSchema, args: z.record(z.string(), z.unknown()).optional(), ttl: durationSchema }).strict()).optional(),
    widgets: z.record(z.string().regex(/^[a-zA-Z][\w-]{0,39}$/), relPathSchema).optional(),
    screens: z.record(z.string().regex(/^[a-zA-Z][\w-]{0,39}$/), relPathSchema).optional(),
    settings: z.array(z.object({ screen: z.string(), title: z.string(), subtitle: z.string().optional(), icon: z.string().optional() }).strict()).optional(),
    commands: z
      .record(
        z.string().regex(/^[a-z][a-z0-9-]*$/),
        z.object({ description: z.string().min(1).max(80), prompt: z.string().min(1).max(2000), aliases: z.array(z.string()).optional(), argHint: z.string().optional() }).strict(),
      )
      .optional(),
    defaultModes: z.object({ read: modeSchema, write: modeSchema, money: modeSchema, public: modeSchema }).partial().optional(),
    cloud: z.record(z.string(), z.unknown()).optional(),
    i18n: z.object({ en: translationSchema.optional() }).optional(),
    remote: z.object({ mcp: z.string().url(), auth: z.enum(['none', 'bearer']).optional() }).strict().optional(),
    /** Server functions, schedules, collections (pku-harness docs/CLOUD-FUNCTIONS.md); see server-schema.ts. */
    server: z.lazy(() => serverSchema).optional(),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;

/** A widget or screen file: a generative-UI spec plus bindings to this plugin's read tools. */
export const viewSchema = z
  .object({
    title: z.string().min(1).max(40),
    description: z.string().max(200).optional(),
    sizes: z.array(z.enum(['sm', 'md', 'lg'])).optional(),
    defaultSize: z.enum(['sm', 'md', 'lg']).optional(),
    presentation: z.enum(['push', 'modal']).optional(),
    spec: z.object({ root: z.string(), elements: z.record(z.string(), z.unknown()), state: z.record(z.string(), z.unknown()).optional() }),
    bindings: z
      .record(
        z.string().regex(/^\//, 'a JSON pointer like /card'),
        z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).optional(), path: z.string().optional(), ttlMinutes: z.number().min(0).max(1440).optional() }).strict(),
      )
      .optional(),
  })
  .strict();
export type ViewDoc = z.infer<typeof viewSchema>;

/** A recorded test (`tests/<name>.yaml`, §12): responses to replay and the expected result. */
export const testSchema = z.object({
  tool: toolNameSchema,
  input: z.record(z.string(), z.unknown()).optional(),
  now: z.union([z.string(), z.number()]).optional(),
  kv: z.record(z.string(), z.unknown()).optional(),
  responses: z
    .array(
      z.object({
        match: z.string(),
        campus: z.string().optional(),
        status: z.number().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        url: z.string().optional(),
        body: z.unknown().optional(),
        file: z.string().optional(),
      }),
    )
    .optional(),
  expect: z.unknown().optional(),
  expectError: z.string().optional(),
});
export type TestDoc = z.infer<typeof testSchema>;

/** `5m` → 300000. */
export function durationMs(d: number | string): number {
  if (typeof d === 'number') return d;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(d.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return n * { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'ms'];
}
