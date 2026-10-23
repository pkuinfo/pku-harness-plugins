# pku-harness-plugins

Every capability of [PKU Harness](https://github.com/pkuinfo/pku-harness) is a plugin, and
every plugin is equal. The app is only the harness: it runs plugins, gives them host services,
and renders what they produce. This repository holds all of them — the ones bundled in the app
and the ones the community runs — plus the SDK and the marketplace registry.

## Repository map

Everything here is open source (MIT). Five folders are published to npm under
[`@pku-harness`](https://www.npmjs.com/org/pku-harness); the rest stay in this repo.

| Folder | npm package | What it is | Used by |
|---|---|---|---|
| [`packages/sdk`](packages/sdk) | [`@pku-harness/sdk`](https://www.npmjs.com/package/@pku-harness/sdk) | The plugin contract (`definePlugin`, tools, `HostServices`, `HostUI`, capabilities) + pure helpers (recurrence, schedules, timetable, checks) | Every plugin, the app, plugin authors |
| [`plugins/<id>`](plugins) | [`@pku-harness/plugins`](https://www.npmjs.com/package/@pku-harness/plugins) | The plugins bundled in the app (`builtinPlugins` in `plugins/index.ts`), one folder per plugin | The app |
| [`packages/campus-card`](packages/campus-card) | [`@pku-harness/campus-card`](https://www.npmjs.com/package/@pku-harness/campus-card) | Campus Card (bdcard) API helpers shared by plugins | `wallet`, `card-share` |
| [`packages/cloud-protocol`](packages/cloud-protocol) | [`@pku-harness/cloud-protocol`](https://www.npmjs.com/package/@pku-harness/cloud-protocol) | PKU Harness Cloud wire protocol: schemas, envelope crypto, share links | The app, `cloud-server`, share pages |
| [`registry`](registry) | [`@pku-harness/registry`](https://www.npmjs.com/package/@pku-harness/registry) | Marketplace schema + `registry.json` (bundled and remote plugins side by side) | The app's 插件市场, `scripts/validate-registry.ts` |
| [`packages/cloud-server`](packages/cloud-server) | — (app) | Reference Cloud server (Bun + Hono + SQLite) | Self-hosters |
| [`templates/remote-plugin`](templates/remote-plugin) | — | Starting point for a remote plugin (MCP over Streamable HTTP) | Plugin authors |
| [`examples/demo-canteen`](examples/demo-canteen) | — | A working remote plugin with mock data | Plugin authors |
| [`examples/mock-llm`](examples/mock-llm) | — | Scripted OpenAI-compatible model server for testing the agent without a key | Contributors |
| [`scripts`](scripts) | — | `release.ts` (version / verify / publish), `validate-registry.ts` | Maintainers |

## Two kinds of plugin, one contract

- **Bundled** plugins are TypeScript modules built on the SDK. They ship inside the app binary
  (app stores forbid downloading executable code) and reach the app only through
  `ctx.services` — never by importing app internals.
- **Remote** plugins are MCP servers. Users add them by URL (or from the marketplace); their tools
  join the same registry, permissions and agent loop. No third-party code runs on the phone, and
  remote plugins never see campus credentials.

A phone is not a workstation: no shell, no filesystem, limited background time, and some campus
hosts answer only on the campus network. Plugins declare `requires` (see `Capability` in the
SDK); the app hides what the device can't run. Anything heavier belongs in a remote plugin.

## Plugin UI

Plugins can contribute screens and Settings rows (`contributes` in `PluginDef`). Screens get
`HostUI` — the harness's components (native controls, tokens, motion), haptics and navigation —
plus `services`, their own `kv` and `invoke(tool, input)`. They never import app code, so a
plugin's UI looks native to the app and keeps working as the harness evolves. See
`plugins/memory/src/screen.tsx`.

**Dashboard widgets.** `contributes.widgets` ships native widgets the user (widget gallery) or
the agent (`dashboard.addPluginWidget`) can place on the dashboard. Load data with
`host.useToolData(tool, args, { ttlMinutes })`: the harness shows the last value at once and
refetches when stale on focus, app foreground and pull-to-refresh, shared with every other
widget and scheduled check, so don't poll yourself. See `plugins/wallet/src/card/widget.tsx`.

## Develop

```bash
bun install
bun test                          # SDK tests (recurrence, schedules, timetable, checks)
bunx tsc --noEmit -p .            # typecheck SDK + plugins
bun scripts/validate-registry.ts  # registry schema + consistency
bun examples/demo-canteen/server.ts
```

## Packages and releases

The app builds against the published npm packages (see the map above), not a checkout of this
repo. They ship TypeScript source (Metro compiles it in the app) and share one version. To release:

```bash
bun scripts/release.ts version 0.2.0   # bump every published package
git commit -am "chore: release 0.2.0"
bun scripts/release.ts publish         # check, test, verify tarballs, then npm publish (2FA in the browser)
git tag v0.2.0 && git push --follow-tags
```

Then bump `@pku-harness/*` in the app; users receive it with the next app update (store
release, or an over-the-air update for JS-only changes).

**Developing a plugin against the app**: clone this repo next to the app
(`pku-info/pku-harness-plugins` beside `pku-info/pku-harness`) and run `bun run plugins:link` in
the app. It points the app's `@pku-harness/*` packages at your checkout, so Metro reloads on
every save; `bun install --force` in the app goes back to the published versions.

See [CONTRIBUTING.md](CONTRIBUTING.md) to add a plugin.
