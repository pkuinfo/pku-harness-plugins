// Version and publish the npm packages the app builds against.
//
//   bun scripts/release.ts version 0.2.0   set every published package to 0.2.0
//   bun scripts/release.ts publish         check, test, then publish them in dependency order
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

if (command === 'version') {
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
  const dry = process.argv.includes('--dry-run') ? ['--dry-run'] : [];
  for (const dir of PACKAGES) await $`bunx npm publish --access public --auth-type=web ${dry}`.cwd(`${root}${dir}`);
  console.log(`published ${[...versions][0]}; tag it: git tag v${[...versions][0]} && git push --tags`);
} else {
  throw new Error('usage: release.ts version <x.y.z> | publish [--dry-run]');
}
