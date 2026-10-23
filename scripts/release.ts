// Version and publish the npm packages the app builds against.
//
//   bun scripts/release.ts version 0.2.0   set every published package to 0.2.0
//   bun scripts/release.ts verify          every tracked source file is in its npm tarball
//   bun scripts/release.ts publish         check, test, verify, then publish in dependency order
//   bun scripts/release.ts publish --dry-run
//
// All published packages share one version, so "@pku-harness/plugins@0.2.0" always pairs with
// "@pku-harness/sdk@0.2.0"; `version` also moves their `@pku-harness/*` ranges to "^<version>".
// Publishing uses npm's CLI: bun publish can't do npm's browser 2FA (`--auth-type=web`).
import { $ } from 'bun';

/** Published packages, dependencies first. Everything else in the workspace stays private. */
const PACKAGES = ['packages/cloud-protocol', 'packages/sdk', 'registry', 'packages/campus-card', 'plugins'];

const root = new URL('..', import.meta.url).pathname;
const [command, arg] = process.argv.slice(2);

async function readPkg(dir: string) {
  return (await Bun.file(`${root}${dir}/package.json`).json()) as { name: string; version: string };
}

/**
 * npm's packer reads `files` globs differently from bun's (it shipped only index.ts files from
 * `*\/src` once), so compare what npm would pack with the git-tracked sources.
 */
async function verify() {
  let ok = true;
  for (const dir of PACKAGES) {
    const cwd = `${root}${dir}`;
    const [pack] = JSON.parse(await $`bunx npm pack --dry-run --json`.cwd(cwd).quiet().text()) as {
      files: { path: string }[];
    }[];
    const packed = new Set(pack!.files.map((f) => f.path));
    const tracked = (await $`git ls-files`.cwd(cwd).quiet().text())
      .split('\n')
      .filter((f) => /\.(ts|tsx|json)$/.test(f) && !/\.test\.ts$|(^|\/)fixtures\/|(^|\/)node_modules\//.test(f))
      .filter((f) => (dir === 'plugins' ? /^(index\.ts|[^/]+\/src\/)/.test(f) : /^(src\/|[^/]+\.(ts|json)$)/.test(f)))
      .filter((f) => !f.endsWith('package.json') || f === 'package.json')
      .filter((f) => !/^tsconfig.*\.json$/.test(f));
    const missing = tracked.filter((f) => !packed.has(f));
    console.log(`${dir}: ${packed.size} files${missing.length ? `, MISSING ${missing.length}` : ''}`);
    for (const f of missing) console.log(`  missing ${f}`);
    if (missing.length) ok = false;
  }
  if (!ok) process.exit(1);
}

if (command === 'verify') {
  await verify();
} else if (command === 'version') {
  if (!arg || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) throw new Error('usage: release.ts version <x.y.z>');
  for (const dir of PACKAGES) {
    const file = `${root}${dir}/package.json`;
    const text = await Bun.file(file).text();
    await Bun.write(
      file,
      text
        .replace(/"version": "[^"]+"/, `"version": "${arg}"`)
        .replace(/("@pku-harness\/[\w-]+": )"\^[^"]+"/g, `$1"^${arg}"`),
    );
    console.log(`${(await readPkg(dir)).name} → ${arg}`);
  }
} else if (command === 'publish') {
  const versions = new Set(await Promise.all(PACKAGES.map(async (d) => (await readPkg(d)).version)));
  if (versions.size !== 1) throw new Error(`packages disagree on version: ${[...versions].join(', ')}`);
  await $`bun run check`.cwd(root);
  await $`bun test`.cwd(root);
  await verify();
  const dry = process.argv.includes('--dry-run') ? ['--dry-run'] : [];
  for (const dir of PACKAGES) await $`bunx npm publish --access public --auth-type=web ${dry}`.cwd(`${root}${dir}`);
  console.log(`published ${[...versions][0]}; tag it: git tag v${[...versions][0]} && git push --tags`);
} else {
  throw new Error('usage: release.ts version <x.y.z> | verify | publish [--dry-run]');
}
