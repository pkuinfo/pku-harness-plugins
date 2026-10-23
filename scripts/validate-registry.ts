// Validate registry/registry.json: schema, unique ids and icons, built-ins exist, sources point here.
import { existsSync } from 'node:fs';

import { registry } from '../registry/schema';

const raw = await Bun.file(new URL('../registry/registry.json', import.meta.url)).json();
const parsed = registry.safeParse(raw);
if (!parsed.success) {
  console.error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
const errors: string[] = [];
const seen = new Set<string>();
// Plugin tiles sit side by side in the grid: two plugins with one icon read as the same thing.
const icons = new Map<string, string>();
for (const p of parsed.data.plugins) {
  if (seen.has(p.id)) errors.push(`duplicate id ${p.id}`);
  seen.add(p.id);
  if (p.icon) {
    const other = icons.get(p.icon);
    if (other) errors.push(`${p.id}: icon '${p.icon}' is already used by ${other}`);
    else icons.set(p.icon, p.id);
  }
  if (p.kind === 'builtin' && !existsSync(new URL(`../plugins/${p.id}/src/index.ts`, import.meta.url))) errors.push(`builtin ${p.id} has no plugins/${p.id}/src/index.ts`);
  if (p.kind === 'remote' && p.requires.includes('shell')) errors.push(`${p.id}: remote plugins run on a server; 'shell' is not a device requirement`);
  if (p.kind === 'builtin' && p.endpoint) errors.push(`${p.id}: builtins have no endpoint`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`registry ok: ${parsed.data.plugins.length} plugins`);
