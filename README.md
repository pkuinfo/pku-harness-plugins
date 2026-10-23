<div align="center">

# PKU Harness Plugins

**Every campus service in [PKU Harness](https://github.com/pkuinfo/pku-harness), as a plugin you can read, share and write yourself.**

[![CI](https://github.com/pkuinfo/pku-harness-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/pkuinfo/pku-harness-plugins/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Plugin language](https://img.shields.io/badge/plugin%20language-spec%201-8B0012.svg)](https://github.com/pkuinfo/pku-harness/blob/master/docs/PLUGIN-LANGUAGE.md)

[Website](https://harness.novadiffusion.com) · [Download the app](https://harness.novadiffusion.com/download) · [Marketplace](https://harness.novadiffusion.com/marketplace) · [Write a plugin](#write-a-plugin-in-five-minutes) · [Language reference](https://github.com/pkuinfo/pku-harness/blob/master/docs/PLUGIN-LANGUAGE.md)

</div>

---

PKU Harness is an open-source, AI-native app for Peking University students. The app itself is
only a harness: an agent, a design system and host services. **Everything it can do comes from
plugins**, and this repository holds all of them: the official ones that ship with the app, the
SDK, the plugin language, and the marketplace registry.

## Highlights

- **Plugins are documents, not code.** A plugin is a folder with a `PLUGIN.md`, like an agent
  skill, written in a small declarative language the app interprets. No build, no package, no
  app release.
- **Shared by link.** Push the folder to GitHub and send the link (or a QR code). The app shows
  exactly what the plugin can reach before installing it, and keeps it updated from the link.
- **Safe by construction.** A plugin can only call the campus services, websites and app
  features it declares. Campus passwords never leave the phone, and every tool goes through the
  user's per-effect permissions (read / write / money / public).
- **Human and AI are equal operators.** Every tool works from a tap and from the agent. The AI
  can even write a plugin with you, test it live, and hand you the review sheet.
- **Tested like software.** Every official plugin ships recorded tests that CI replays.

## Official plugins

| Plugin | What it does | Kind |
|---|---|---|
| [`classrooms`](plugins/classrooms) | Free classrooms per building and period | Document |
| [`canteen`](plugins/canteen) | Live canteen crowding, opening hours, notices | Document |
| [`shuttle`](plugins/shuttle) | Next campus shuttle between Yanyuan and the new campus | Document |
| [`notices`](plugins/notices) | Official notices from six university sites and WeChat | Document |
| [`campus-events`](plugins/campus-events) | Academic talks and campus activities | Document |
| [`grades`](plugins/grades) | Grades and GPA (with the treehole second factor handled) | Document |
| `wallet`, `finance`, `courses`, `library`, `treehole`, `elective`, `room-booking`, `course-catalog`, `calendar`, … | Campus card, finance portal, Blackboard, library, forum, course selection and more | TypeScript (being ported) |
| `dashboard`, `schedule`, `scheduler`, `todo`, `timetable`, `memory`, `plugins`, `ui`, `deepseek`, `openai-compatible` | The harness's own features and model providers | TypeScript |

The full list, including community plugins, is in [`registry/registry.json`](registry/registry.json)
and on the [marketplace](https://harness.novadiffusion.com/marketplace).

## Write a plugin in five minutes

A plugin is a folder:

```
my-plugin/
├── PLUGIN.md          # manifest (YAML frontmatter) + instructions for the AI (Markdown)
├── tools/free.yaml    # one file per tool, in the plugin language
├── widgets/*.json     # optional dashboard widgets (generative UI)
└── tests/*.yaml       # optional recorded tests
```

`PLUGIN.md`:

```markdown
---
spec: 1
id: my-plugin
name: 空闲教室
description: Free classrooms in a teaching building.
version: 1.0.0
author: your-github-name
network: [portal.pku.edu.cn]
tools:
  free: tools/free.yaml
---

Use `free` when the user asks where to study.
```

`tools/free.yaml`:

```yaml
title: 空闲教室
description: Free rooms in one teaching building today.
effect: read
input:
  building: { type: string, default: 二教 }
steps:
  - let: r
    request:
      url: https://portal.pku.edu.cn/publicQuery/classroomQuery/retrClassRoomFree.do
      query: { buildingName: '${input.building}', time: 今天 }
      headers: { referer: 'https://portal.pku.edu.cn/publicQuery/' }
    as: json
  - check: r.success
    error: The portal did not answer
return: "r.rows.map(x => ({ room: x.room, seats: num(x.cap, 0) }))"
```

Plugin names and tool titles are shown to students, so they are usually Chinese; descriptions
and instructions are for the AI and can be English. Check and run the plugin on your computer, no
phone needed:

```bash
bun install
bun run plugin validate path/to/my-plugin      # schema, expressions, declared hosts: precise errors
bun run plugin run path/to/my-plugin free      # call the real site
bun run plugin test path/to/my-plugin          # replay tests/*.yaml
```

Then push the folder to GitHub and install it in the app with its link, or with
`pkuharness://plugin?src=<link>`. The [language reference](https://github.com/pkuinfo/pku-harness/blob/master/docs/PLUGIN-LANGUAGE.md)
covers every step, the expression standard library, host abilities, widgets and limits, and
[`plugins/classrooms`](plugins/classrooms) is a complete, tested example.

## Three kinds of plugin, one contract

| Kind | Where it runs | Use it for |
|---|---|---|
| **Document** (`PLUGIN.md`) | Interpreted by the app, sandboxed to what it declares | Campus integrations: the default |
| **Remote** (MCP over HTTPS) | Your server | Heavy work, third-party APIs, your own backend |
| **TypeScript** (bundled) | Inside the app binary | The harness's own features and host abilities |

All three compile to the same plugin contract (`@pku-harness/sdk`), so tools, permissions,
approvals, widgets and the agent work the same way for each.

## Repository map

| Path | Contents |
|---|---|
| [`plugins/<id>/PLUGIN.md`](plugins/classrooms) | Plugin documents (official) |
| [`plugins/<id>/src`](plugins) | TypeScript plugins (`builtinPlugins` in `plugins/index.ts`) |
| [`plugins/shared`](plugins/shared) | Code shared by TypeScript plugins |
| [`packages/sdk`](packages/sdk) | The plugin contract, pure helpers, and the plugin language in `src/lang` (schemas, interpreter, abilities, loader) |
| [`packages/cloud-protocol`](packages/cloud-protocol) | Wire protocol of PKU Harness Cloud (schemas, envelope crypto, share links) |
| [`packages/cloud-server`](packages/cloud-server) | Reference Cloud server (Bun + Hono + SQLite) |
| [`registry`](registry) | Marketplace schema and `registry.json` |
| [`templates/remote-plugin`](templates/remote-plugin) | Starting point for a remote (MCP) plugin |
| [`examples`](examples) | A demo remote plugin and a scripted model server for testing the agent without a key |
| [`scripts`](scripts) | `plugin.ts` (author CLI), `bundle-docs.ts`, `validate-registry.ts` |

## Development

Requires [Bun](https://bun.sh) 1.3 or newer.

```bash
git clone https://github.com/pkuinfo/pku-harness-plugins.git
cd pku-harness-plugins
bun install
bun run verify     # typecheck, registry, bundled documents, all tests (exactly what CI runs)
```

The app consumes this repository as a git submodule. After changing an official plugin document,
run `bun run bundle` so the app ships the new version; CI fails if you forget.

## Contributing

Contributions are welcome, from fixing a parser after a university site changes to writing a new
plugin. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the plugin rules and the review process, and
please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

PKU Harness handles campus credentials. Please report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), never in a public issue.

## Related repositories

| Repository | Role |
|---|---|
| [pkuinfo/pku-harness](https://github.com/pkuinfo/pku-harness) | The app (Expo / React Native) |
| [pkuinfo/pkuharness-website](https://github.com/pkuinfo/pkuharness-website) | Website, developer docs and marketplace |
| [pkuinfo/pkucli](https://github.com/pkuinfo/pkucli) | Command-line tools for PKU services: the protocol reference for plugins |

## License

[MIT](LICENSE) © pkuinfo contributors
