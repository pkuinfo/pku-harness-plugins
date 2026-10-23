# pku-harness-plugins

Every capability of [PKU Harness](https://github.com/pkuinfo/pku-harness) is a plugin, and
every plugin is equal. The app is only the harness: it runs plugins, gives them host services,
and renders what they produce. This repository holds all of them — the ones bundled in the app
and the ones the community runs — plus the SDK and the marketplace registry.

| Path | What |
|---|---|
| `packages/sdk` | `@pku-harness/sdk`: the plugin contract (`definePlugin`, tools, providers, `HostServices`, capabilities) and pure helpers (recurrence engine, schedule parsing, timetable model, check conditions) with tests |
| `plugins/<id>` | Plugins bundled in the app: `ui`, `dashboard`, `scheduler`, `todo`, `timetable`, `calendar`, `plugins`, `deepseek`, `openai-compatible` |
| `registry/registry.json` | The marketplace index the app's 插件市场 reads (built-in and remote plugins side by side) |
| `templates/remote-plugin` | Starting point for a remote plugin (MCP over Streamable HTTP) |
| `examples/demo-canteen` | A working remote plugin with mock data |
| `examples/mock-llm` | Scripted OpenAI-compatible model server for testing the agent loop without a key |

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

The app builds against published npm packages, not a checkout of this repo:

| Package | Folder | Contents |
|---|---|---|
| [`@pku-harness/sdk`](https://www.npmjs.com/package/@pku-harness/sdk) | `packages/sdk` | Plugin contract + pure helpers |
| [`@pku-harness/cloud-protocol`](https://www.npmjs.com/package/@pku-harness/cloud-protocol) | `packages/cloud-protocol` | PKU Harness Cloud wire schemas + envelope crypto |
| [`@pku-harness/plugins`](https://www.npmjs.com/package/@pku-harness/plugins) | `plugins` | Every bundled plugin (`builtinPlugins`) |
| [`@pku-harness/registry`](https://www.npmjs.com/package/@pku-harness/registry) | `registry` | Marketplace schema + `registry.json` |

They ship TypeScript source (Metro compiles it in the app) and share one version. To release:

```bash
bun scripts/release.ts version 0.2.0   # bump every published package
git commit -am "chore: release 0.2.0"
bun scripts/release.ts publish         # check + test, then bun publish (npm 2FA)
git tag v0.2.0 && git push --follow-tags
```

Then bump `@pku-harness/*` in the app; users receive it with the next app update (store
release, or an over-the-air update for JS-only changes).

**Developing a plugin against the app**: clone this repo next to the app
(`pku-info/pku-harness-plugins` beside `pku-info/pku-harness`) and run `bun run plugins:link` in
the app. It points the app's `@pku-harness/*` packages at your checkout, so Metro reloads on
every save; `bun install` in the app goes back to the published versions.

See [CONTRIBUTING.md](CONTRIBUTING.md) to add a plugin.
