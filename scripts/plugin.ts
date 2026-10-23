// Work on a plugin document (pku-harness docs/PLUGIN-LANGUAGE.md) on a computer, no phone needed.
//
//   bun scripts/plugin.ts validate <dir>              check PLUGIN.md and every file it names
//   bun scripts/plugin.ts test <dir>                  replay tests/*.yaml (recorded responses)
//   bun scripts/plugin.ts run <dir> <tool> [json]     run a tool live (public hosts only;
//                                                     campus requests need the app)
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDocument, parseTest, PluginDocError, runTool, type PluginDocument, type PublicFetch } from '../packages/sdk/src';
import { memoryKV, runRecorded } from '../packages/sdk/src/lang/testing';

const [command, dirArg, ...rest] = process.argv.slice(2);
if (!command || !dirArg || !['validate', 'test', 'run'].includes(command)) {
  console.error('usage: bun scripts/plugin.ts validate|test|run <plugin-dir> [tool] [json-input]');
  process.exit(2);
}
const dir = resolve(dirArg);

async function load(): Promise<PluginDocument> {
  try {
    return await loadDocument(async (p) => readFileSync(join(dir, p), 'utf8'));
  } catch (e) {
    if (e instanceof PluginDocError) {
      console.error(`✗ ${dirArg}\n  ${e.issues.join('\n  ')}`);
      process.exit(1);
    }
    throw e;
  }
}

const liveFetch: PublicFetch = async (req) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: req.followRedirects ? 'follow' : 'manual', signal: ctrl.signal });
    return { status: res.status, url: res.url, headers: Object.fromEntries(res.headers), body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
};

const doc = await load();
const m = doc.manifest;

if (command === 'validate') {
  console.log(`✓ ${m.id} ${m.version} — ${Object.keys(doc.tools).length} tools, ${Object.keys(doc.widgets).length} widgets, ${Object.keys(doc.screens).length} screens`);
  console.log(`  campus: ${m.campus?.join(', ') || '—'} · network: ${m.network?.join(', ') || '—'} · abilities: ${m.abilities?.join(', ') || '—'}`);
} else if (command === 'test') {
  let tests: string[] = [];
  try {
    tests = readdirSync(join(dir, 'tests')).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    /* no tests folder */
  }
  if (!tests.length) {
    console.log(`no tests in ${dirArg}/tests`);
    process.exit(0);
  }
  let failed = 0;
  for (const file of tests.sort()) {
    const t = parseTest(readFileSync(join(dir, 'tests', file), 'utf8'), `tests/${file}`);
    const fixtures: Record<string, string> = {};
    for (const r of t.responses ?? []) if (r.file) fixtures[r.file] = readFileSync(join(dir, 'tests', r.file), 'utf8');
    try {
      const { result } = await runRecorded(doc, t, fixtures);
      if (t.expectError) throw new Error(`expected an error matching /${t.expectError}/, got a result`);
      if (t.expect !== undefined && !Bun.deepEquals(result, t.expect)) {
        throw new Error(`result differs\n    expected: ${JSON.stringify(t.expect)}\n    actual:   ${JSON.stringify(result)}`);
      }
      console.log(`✓ ${file}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (t.expectError && new RegExp(t.expectError).test(msg)) {
        console.log(`✓ ${file} (error: ${msg})`);
        continue;
      }
      failed++;
      console.log(`✗ ${file}: ${msg}`);
    }
  }
  if (failed) process.exit(1);
} else {
  const [tool, json] = rest;
  if (!tool) {
    console.error(`tools: ${Object.keys(doc.tools).join(', ')}`);
    process.exit(2);
  }
  const services = {
    campus: {
      request: async () => {
        throw new Error('campus services need the app (or a recorded test)');
      },
      otp: async () => null,
    },
  } as never;
  const result = await runTool({ manifest: m, tools: doc.tools, services, kv: memoryKV(), fetch: liveFetch }, tool, json ? JSON.parse(json) : {});
  console.log(JSON.stringify(result, null, 2));
}
