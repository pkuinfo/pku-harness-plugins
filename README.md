# pku-harness-plugins

Every capability of [PKU Harness](https://github.com/pkuinfo/pku-harness) is a plugin, and
every plugin is equal. The app is only the harness: it runs plugins, gives them host services,
and renders what they produce. This repository holds all of them — the ones bundled in the app
and the ones the community runs — plus the SDK and the marketplace registry.

## Repository map

Everything here is open source (MIT).

| Folder | What it is |
|---|---|
| [`plugins/<id>/PLUGIN.md`](plugins/classrooms) | **Plugin documents**: integrations written in the plugin language, shared and installed by link (classrooms, campus-events, grades, …) |
| [`plugins/<id>/src`](plugins) | TypeScript plugins: the harness's own features (dashboard, schedule, memory, scheduler, model providers…) and integrations not yet ported (`builtinPlugins` in `plugins/index.ts`) |
| [`packages/sdk`](packages/sdk) | The plugin contract (`definePlugin`, tools, `HostServices`, `HostUI`, capabilities), pure helpers, and **the plugin language** in `src/lang` (schemas, interpreter, abilities, loader) |
| [`plugins/shared`](plugins/shared) | Code shared by bundled plugins (e.g. `campus-card.ts`) |
| [`packages/cloud-protocol`](packages/cloud-protocol) | PKU Harness Cloud wire protocol: schemas, envelope crypto, share links |
| [`packages/cloud-server`](packages/cloud-server) | Reference Cloud server (Bun + Hono + SQLite) |
| [`registry`](registry) | Marketplace schema + `registry.json` (bundled and remote plugins side by side) |
| [`templates/remote-plugin`](templates/remote-plugin) | Starting point for a remote plugin (MCP over Streamable HTTP) |
| [`examples/demo-canteen`](examples/demo-canteen) | A working remote plugin with mock data |
| [`examples/mock-llm`](examples/mock-llm) | Scripted OpenAI-compatible model server for testing the agent without a key |
| [`scripts`](scripts) | `plugin.ts` (validate / test / run a plugin document), `bundle-docs.ts`, `validate-registry.ts` |

## Write a plugin: a folder with a PLUGIN.md

A plugin is shared like a skill: a folder with a `PLUGIN.md` (YAML frontmatter = what it may
reach; Markdown = instructions for the AI) and the tool files it names, written in a small
declarative language the app interprets. No build, no package, no app release: push the folder
to GitHub and share the link (or `pkuharness://plugin?src=<link>`). The app shows what the plugin
can reach before installing it and keeps it updated from the link.

```bash
bun run plugin validate plugins/classrooms      # check everything, with precise messages
bun run plugin test plugins/classrooms          # replay tests/*.yaml (recorded responses)
bun run plugin run plugins/classrooms overview  # call the real site (public hosts)
```

Start from [`plugins/classrooms`](plugins/classrooms). Language reference:
[pku-harness docs/PLUGIN-LANGUAGE.md](https://github.com/pkuinfo/pku-harness/blob/master/docs/PLUGIN-LANGUAGE.md)
and the [quickstart on the website](https://github.com/pkuinfo/pkuharness-website). You can also
ask the AI in the app to write one with you (`plugins.reference` / `validate` / `tryTool` /
`install`). After changing an official document, run `bun run bundle` (the app ships them).

## Three kinds of plugin, one contract

- **Documents** (`PLUGIN.md`) are interpreted by the app: they reach only the campus services,
  hosts and app abilities they declare, and every tool still goes through the user's permission
  modes. This is the default for campus integrations.
- **TypeScript** plugins are modules built on the SDK, for the harness's own features and things
  the language can't express yet. They ship inside the app binary (app stores forbid
  downloading executable code) and reach the app only through `ctx.services`.
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
bun run check                     # typecheck, registry, bundled documents up to date
bun test                          # SDK, TS plugins and every PLUGIN.md's recorded tests
bun examples/demo-canteen/server.ts
```

The app consumes this repo as a git submodule (`pku-harness/plugins`) and resolves
`@pku-harness/sdk` and the plugins through TypeScript paths. A declarative plugin format, shared
as a folder or link instead of compiled code, is being designed in the app repo
(`docs/PLUGIN-LANGUAGE.md`).

See [CONTRIBUTING.md](CONTRIBUTING.md) to add a plugin.
