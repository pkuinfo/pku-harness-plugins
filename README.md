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

## Develop

```bash
bun install
bun test                          # SDK tests (recurrence, schedules, timetable, checks)
bunx tsc --noEmit -p .            # typecheck SDK + plugins
bun scripts/validate-registry.ts  # registry schema + consistency
bun examples/demo-canteen/server.ts
```

The app consumes this repo as a git submodule (`pku-harness/plugins`) and resolves
`@pku-harness/sdk` and the plugins through TypeScript paths.

See [CONTRIBUTING.md](CONTRIBUTING.md) to add a plugin.
