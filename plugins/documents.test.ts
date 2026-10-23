/**
 * Every plugin document (plugins/<id>/PLUGIN.md) loads and passes its recorded tests
 * (tests/*.yaml), the same as `bun scripts/plugin.ts test <dir>`.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDocument, parseTest } from '../packages/sdk/src';
import { runRecorded } from '../packages/sdk/src/lang/testing';

const root = import.meta.dir;
const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'PLUGIN.md')));

for (const { name } of dirs) {
  const dir = join(root, name);
  describe(`document ${name}`, () => {
    test('loads', async () => {
      const doc = await loadDocument(async (p) => readFileSync(join(dir, p), 'utf8'));
      expect(doc.manifest.id).toBe(name);
    });
    const testsDir = join(dir, 'tests');
    const files = existsSync(testsDir) ? readdirSync(testsDir).filter((f) => /\.ya?ml$/.test(f)) : [];
    for (const file of files) {
      test(file, async () => {
        const doc = await loadDocument(async (p) => readFileSync(join(dir, p), 'utf8'));
        const t = parseTest(readFileSync(join(testsDir, file), 'utf8'), file);
        const fixtures: Record<string, string> = {};
        for (const r of t.responses ?? []) if (r.file) fixtures[r.file] = readFileSync(join(testsDir, r.file), 'utf8');
        const run = runRecorded(doc, t, fixtures);
        if (t.expectError) await expect(run).rejects.toThrow(new RegExp(t.expectError));
        else if (t.expect !== undefined) expect((await run).result).toEqual(t.expect as never);
        else await run;
      });
    }
  });
}
