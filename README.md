# pku-harness-plugins

Every capability of [PKU Harness](https://github.com/pkuinfo/pku-harness) is a plugin, and
every plugin is equal. The app is only the harness: it runs plugins, gives them host services,
and renders what they produce. This repository holds all of them — the ones bundled in the app
and the ones the community runs — plus the SDK and the marketplace registry.

## Repository map

Everything here is open source (MIT).

| Folder | What it is |
|---|---|
| [`packages/sdk`](packages/sdk) | The plugin contract (`definePlugin`, tools, `HostServices`, `HostUI`, capabilities) + pure helpers (recurrence, schedules, timetable, checks) |
| [`plugins/<id>`](plugins) | The plugins bundled in the app (`builtinPlugins` in `plugins/index.ts`), one folder per plugin |
| [`plugins/shared`](plugins/shared) | Code shared by bundled plugins (e.g. `campus-card.ts`) |
| [`packages/cloud-protocol`](packages/cloud-protocol) | PKU Harness Cloud wire protocol: schemas, envelope crypto, share links |
| [`packages/cloud-server`](packages/cloud-server) | Reference Cloud server (Bun + Hono + SQLite) |
| [`registry`](registry) | Marketplace schema + `registry.json` (bundled and remote plugins side by side) |
| [`templates/remote-plugin`](templates/remote-plugin) | Starting point for a remote plugin (MCP over Streamable HTTP) |
| [`examples/demo-canteen`](examples/demo-canteen) | A working remote plugin with mock data |
| [`examples/mock-llm`](examples/mock-llm) | Scripted OpenAI-compatible model server for testing the agent without a key |
| [`scripts`](scripts) | `validate-registry.ts` |

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

The app consumes this repo as a git submodule (`pku-harness/plugins`) and resolves
`@pku-harness/sdk` and the plugins through TypeScript paths. A declarative plugin format, shared
as a folder or link instead of compiled code, is being designed in the app repo
(`docs/PLUGIN-LANGUAGE.md`).

See [CONTRIBUTING.md](CONTRIBUTING.md) to add a plugin.
