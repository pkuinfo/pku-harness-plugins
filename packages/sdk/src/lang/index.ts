// The plugin language (docs/PLUGIN-LANGUAGE.md in pku-harness): plugins as shareable PLUGIN.md
// folders, interpreted by the harness.
export { ABILITIES, ABILITY_IDS, type AbilityDef } from './abilities';
export { compilePlugin, inputZod, type CompileOptions } from './compile';
export { ExprError } from './expr';
export { fileUrl, installDeepLink, LinkError, resolveLink, type PluginLink } from './link';
export { declarations, fingerprintText, loadDocument, parseTest, PluginDocError, splitFrontmatter, validateTool, widens, type PluginDocument, type ReadFile } from './load';
export { LIMITS, runTool, ToolFailure, type PublicFetch, type RunEnv } from './run';
export {
  abilitySchema,
  durationMs,
  manifestSchema,
  pluginIdSchema,
  SPEC_VERSION,
  testSchema,
  toolSchema,
  viewSchema,
  type Ability,
  type FieldDef,
  type Manifest,
  type TestDoc,
  type ToolDoc,
  type ViewDoc,
} from './schema';
export { STDLIB_NAMES } from './stdlib';
