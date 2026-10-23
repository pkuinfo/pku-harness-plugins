# Contributing to PKU Harness Plugins

Thank you for helping make campus life at Peking University a little easier. This guide covers
how to set up the repository, the rules every plugin follows, and how changes are reviewed.

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Writing a plugin](#writing-a-plugin)
- [Plugin rules](#plugin-rules)
- [Testing](#testing)
- [Listing a plugin in the marketplace](#listing-a-plugin-in-the-marketplace)
- [Pull requests](#pull-requests)

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues
go through [SECURITY.md](SECURITY.md), never through public issues.

## Ways to contribute

- **Fix a broken service.** University sites change; a plugin that stopped working is the most
  valuable thing to fix. Open a [service broke](https://github.com/pkuinfo/pku-harness-plugins/issues/new?template=service_broken.yml)
  issue or send a fix with an updated recorded test.
- **Write a new plugin** for a campus service the app doesn't cover yet. Propose it first with a
  [new plugin](https://github.com/pkuinfo/pku-harness-plugins/issues/new?template=new_plugin.yml)
  issue, so we can agree on its tools and permissions.
- **Port a TypeScript plugin to a plugin document** (see the port list in the app's
  [`docs/PLAN.md`](https://github.com/pkuinfo/pku-harness/blob/master/docs/PLAN.md)).
- **Improve the SDK or the plugin language** in `packages/sdk`. Larger changes start with an
  [SDK issue](https://github.com/pkuinfo/pku-harness-plugins/issues/new?template=plugin_dev.yml).

## Development setup

Requirements: [Bun](https://bun.sh) 1.3+ and git. No Android tooling is needed to work on plugins.

```bash
git clone https://github.com/pkuinfo/pku-harness-plugins.git
cd pku-harness-plugins
bun install
bun run verify
```

`bun run verify` runs exactly what CI runs: the typecheck, registry validation, the
bundled-documents check, and every test, including the recorded tests of each plugin document.
Run it before every push and only push when it passes.

To try plugins in the app, follow the app's
[contributing guide](https://github.com/pkuinfo/pku-harness/blob/master/CONTRIBUTING.md): the
app consumes this repository as its `plugins/` submodule.

## Writing a plugin

Choose the kind:

| Kind | When |
|---|---|
| **Plugin document** (`PLUGIN.md`) | Almost always. Campus integrations, public data, anything expressible as requests, extraction and transforms. |
| **Remote** (MCP server) | You need a server: heavy computation, third-party APIs with keys, your own backend. Start from [`templates/remote-plugin`](templates/remote-plugin). |
| **TypeScript** (bundled) | Only for the harness's own features or new host abilities. Open an issue first. |

A plugin document is a folder with a `PLUGIN.md` and the tool files it names. The
[language reference](https://github.com/pkuinfo/pku-harness/blob/master/docs/PLUGIN-LANGUAGE.md)
is the specification; [`plugins/classrooms`](plugins/classrooms) is a short, complete example and
[`plugins/notices`](plugins/notices) a large one. The author CLI checks your work as you go:

```bash
bun run plugin validate plugins/my-plugin          # every file, expression and declaration
bun run plugin run plugins/my-plugin tool '{"a":1}' # live call (public hosts; campus needs the app)
bun run plugin test plugins/my-plugin              # replay tests/*.yaml
```

Official plugin documents live in `plugins/<id>/`. After changing one, run `bun run bundle` so the
app ships the new version (the check fails otherwise).

## Plugin rules

1. **Tools are the API.** Each tool has a short `title` shown to users (usually Chinese) and a
   `description` for the model that says when and how to use it. Inputs are typed; validate
   ranges and formats in the input schema.
2. **Declare effects honestly.** `read` tools must not change anything. Anything that changes
   state is `write`; spending money is `money`; posting publicly is `public`. Users choose per
   effect whether the agent may act directly or must ask, so a wrong effect is a security bug.
3. **Declare what you reach.** List campus services in `campus:`, public hosts in `network:` and
   app features in `abilities:`. The app enforces these lists and shows them before install.
4. **Never handle credentials.** Plugins never see campus passwords, cookies or tokens: campus
   requests are signed by the app. Don't ask users for passwords, and never return secrets in a
   tool result.
5. **Return data, not instructions.** Tool results reach the model as data. Mark tools that
   return third-party text (posts, notices) with `untrusted: true`, and never put prompts in
   results.
6. **Port protocols from [pkucli](https://github.com/pkuinfo/pkucli)** when it already implements
   a service, and cite the source file in a comment.
7. **Be bilingual where users read.** Put English translations of user-facing manifest strings
   (name, description, tool titles, widgets, commands) under `i18n.en`. Descriptions and
   instructions for the model don't need translating.
8. **Keep repository documents in English.** READMEs, comments, commit messages, issues and pull
   requests are in English; Chinese belongs only in user-facing app text.

## Testing

Every plugin document ships recorded tests in `tests/*.yaml`: the tool, its input, a fixed clock,
the responses to replay and the expected result.

```yaml
tool: free
input: { building: 理教 }
now: 2026-10-23 14:20          # Beijing time
responses:
  - { match: retrClassRoomFree.do, file: free-lijiao.json, headers: { content-type: application/json } }
expect: { day: today, periods: "6-12", total: 12, rooms: [ ... ] }
```

Record real responses once (strip anything personal), cover the main paths and the error paths,
and keep fixtures small. When you port a TypeScript plugin, compare both versions on the same
responses before removing the TypeScript code.

## Listing a plugin in the marketplace

Community plugins don't need a pull request here: register your repository on the
[website](https://harness.novadiffusion.com/marketplace), which indexes every `PLUGIN.md` in it.

The curated list in [`registry/registry.json`](registry/registry.json) holds official and
reviewed plugins. To add a remote (MCP) plugin to it:

```json
{
  "id": "my-plugin",
  "name": "My plugin",
  "description": "One sentence about what it does.",
  "author": "your-github-name",
  "source": "https://github.com/you/my-plugin",
  "kind": "remote",
  "endpoint": "https://my-plugin.example.com/mcp",
  "auth": "none",
  "requires": ["network"],
  "scopes": ["example.com"],
  "tags": ["canteen"]
}
```

Use the registry `id` as your MCP server `name`: the app installs remote plugins as
`mcp-<server name>`. A plugin that uses PKU Harness Cloud also copies its `cloud` declaration,
whose `disclosure` must say in plain words what leaves the device. Maintainers review new entries
and mark them `verified` after checking the source.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one plugin or one change.
3. Write commits in the [Conventional Commits](https://www.conventionalcommits.org/) style, for
   example `fix(canteen): read the new hours table layout` or `feat(sdk): add htmlLines()`.
4. Run `bun run verify` and make sure it passes.
5. Fill in the pull request template, including how you tested against the live service.
   Redact any personal data in logs and screenshots.

A maintainer reviews every pull request. Plugin changes are checked for honest effects, declared
access and test coverage; CI must be green before merging.
