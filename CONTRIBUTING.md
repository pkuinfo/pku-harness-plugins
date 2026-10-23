# Contributing a plugin

Thank you for building for the PKU community. A plugin connects PKU Harness to a campus
service or adds a capability; the agent and the user use it through the same typed tools.

## Choose the kind

- **Plugin document (most contributions)**: a folder with a `PLUGIN.md` and tool files in the
  plugin language (see the README and `plugins/classrooms`). Users install it from your GitHub
  link; to list it in the marketplace, register your repo on the website. To make it official
  (bundled), open a PR adding the folder under `plugins/` with recorded `tests/*.yaml`.
- **Remote**: write an MCP server (start from `templates/remote-plugin`),
  deploy it over HTTPS, and register it. You can iterate without app releases, and you can use
  any language or library.
- **TypeScript (bundled)**: only for capabilities that need the device itself (notifications, on-device
  data) or that every user needs. Open an issue first; bundled plugins ship with app releases.

## Rules

1. **Tools are the API.** Clear `title` (Chinese, shown to users) and `description` (for the
   model: when and how to use it). Validate input (zod for bundled, JSON Schema for MCP).
2. **Declare effects honestly.** Read-only tools set `readOnlyHint: true` (MCP) or
   `effect: 'read'`. Anything that changes state, spends money or posts publicly must say so;
   users choose per effect whether the agent may act directly or must ask.
3. **Never ask for campus passwords.** Credentials stay on the user's phone. If you need an
   authenticated campus session, say so in the registry entry; scoped session grants are on the
   roadmap.
4. **Return data, not instructions.** Tool results are shown to the model as data. Don't embed
   prompts in results.
5. **Declare `requires`** (network, campus-network, notifications, background…). Don't depend on
   a shell or filesystem on the phone.
6. **Port campus protocols from [pkucli](https://github.com/pkuinfo/pkucli)** where it already
   implements them, and credit the source file.
7. **Be bilingual** (bundled plugins). Add `i18n: { en: {...} }` to `definePlugin` for every
   user-facing manifest string (name, description, tool titles, widgets, screens, settings rows,
   commands, data sources), and keep screen/widget text in a `src/strings.ts` table
   (`defineStrings({ 'zh-Hans': {...}, en: {...} })`) picked with `host.useLocale()`. Format dates
   with the SDK helpers (`formatLocalDate`, `formatRelative`, …). `plugins/i18n.test.ts` checks
   coverage. Tool descriptions, instructions and results are for the model: don't translate them.

## Register

Add an entry to `registry/registry.json`:

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "description": "一句话说明它做什么。",
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

Use the registry `id` as your MCP server `name` (`new McpServer({ name: 'my-plugin', … })`): the app
installs remote plugins as `mcp-<server name>` and uses that to show them as installed.

If the plugin uses PKU Harness Cloud (`PluginDef.cloud`), copy its `cloud` declaration into the
entry (`{ "uses": [...], "e2e": true, "disclosure": { "zh": [...] } }`): the market shows it before
install, and `disclosure.zh` must say in plain words what leaves the device.

Run `bun scripts/validate-registry.ts`, then open a pull request. Maintainers review new
entries and mark them `verified` after checking the source.
