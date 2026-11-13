<div align="center">

<img src="https://pkuharness.com/icon.png" width="88" alt="PKU harness logo" />

# PKU harness Plugins

**Every campus service in [PKU harness](https://github.com/pkuinfo/pku-harness), as a plugin you can read, share and write yourself.**

[![CI](https://github.com/pkuinfo/pku-harness-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/pkuinfo/pku-harness-plugins/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Plugin language](https://img.shields.io/badge/plugin%20language-spec%201-8B0012.svg)](https://github.com/pkuinfo/pku-harness/blob/main/docs/PLUGIN-LANGUAGE.md)

[Website](https://pkuharness.com/en) · [Download the app](https://pkuharness.com/en/download) · [Marketplace](https://pkuharness.com/en/marketplace) · [Docs](https://pkuharness.com/en/docs/build) · [Write a plugin](#write-a-plugin-in-five-minutes) · [Language reference](https://github.com/pkuinfo/pku-harness/blob/main/docs/PLUGIN-LANGUAGE.md)

</div>

---

PKU harness is an open-source, AI-native app for Peking University students. The app itself is
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
| [`library`](plugins/library) | Catalogue search, loans and renewals, holds, study rooms and seats | Document |
| [`treehole`](plugins/treehole) | Browse, search, follow and post on the campus forum | Document |
| [`elective`](plugins/elective) | Course selection results and open seats (read-only) | Document |
| [`course-catalog`](plugins/course-catalog) | Search every course offered this term | Document |
| [`course-sync`](plugins/course-sync) | Sync this term's timetable into the schedule | Document |
| [`room-booking`](plugins/room-booking) | Book seminar rooms in the teaching buildings | Document |
| [`finance`](plugins/finance) | Stipends and income, tuition and housing fees, payment orders (read-only) | Document |
| [`courses`](plugins/courses) | Blackboard: announcements, assignments and deadlines (synced to to-dos), submitting, grades, materials, lecture recordings | Document |
| [`wallet`](plugins/wallet) | Campus Card balance, payment code and top-ups, transactions and monthly stats, network fee, bath card, payment platform | Document |
| `calendar`, `card-share`, `authenticator` | Academic calendar, payment-code sharing, OTP | TypeScript (need host abilities; being ported) |
| `dashboard`, `schedule`, `scheduler`, `todo`, `timetable`, `ledger`, `memory`, `plugins`, `ui`, `deepseek`, `openai-compatible` | The harness's own features and model providers | TypeScript |

The full list, including community plugins, is in [`registry/registry.json`](registry/registry.json)
and on the [marketplace](https://pkuharness.com/marketplace).

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
`pkuharness://plugin?src=<link>`. The [language reference](https://github.com/pkuinfo/pku-harness/blob/main/docs/PLUGIN-LANGUAGE.md)
covers every step, the expression standard library, host abilities, widgets and limits, and
[`plugins/classrooms`](plugins/classrooms) is a complete, tested example.

## Publish to the marketplace

The [marketplace](https://pkuharness.com/en/marketplace) indexes GitHub repositories
the way [skills.sh](https://skills.sh) indexes skills: one repository can hold many plugins, each
found by its `PLUGIN.md`.

1. Push your plugin folder (or a repository of several) to a public GitHub repository.
2. Open [pkuharness.com/marketplace/submit](https://pkuharness.com/en/marketplace/submit),
   paste the repository and fix anything the scanner reports.
3. Submit. A bot rescans the repository, comments its report on the submission issue and opens
   a pull request that lists it. Once merged, your plugin gets a page with its access review,
   install link, deep link and QR code.

You don't need a pull request here. The curated [`registry/registry.json`](registry/registry.json)
holds official and reviewed plugins; see [CONTRIBUTING.md](CONTRIBUTING.md#listing-a-plugin-in-the-marketplace)
to add a remote (MCP) plugin to it, and the [publishing guide](https://pkuharness.com/en/docs/marketplace/publishing)
for details.

## Documentation

| Topic | Where |
|---|---|
| Quick start: your first plugin | [Build → Quick start](https://pkuharness.com/en/docs/build/quickstart) |
| Tools, effects and permissions | [Build → Tools](https://pkuharness.com/en/docs/build/tools) · [Concepts → Permissions](https://pkuharness.com/en/docs/concepts/permissions) |
| Recorded tests | [Build → Testing](https://pkuharness.com/en/docs/build/testing) |
| Porting a service from pkucli | [Build → Porting from pkucli](https://pkuharness.com/en/docs/build/porting-from-pkucli) |
| Remote (MCP) plugins | [Build → Remote plugin](https://pkuharness.com/en/docs/build/remote-plugin) |
| SDK and host services | [SDK reference](https://pkuharness.com/en/docs/sdk) |
| Language specification | [PLUGIN-LANGUAGE.md](https://github.com/pkuinfo/pku-harness/blob/main/docs/PLUGIN-LANGUAGE.md) |
| For AI coding agents | [`/llms.txt`](https://pkuharness.com/llms.txt) · [`/llms-full.txt`](https://pkuharness.com/llms-full.txt) |

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
| [`packages/cloud-protocol`](packages/cloud-protocol) | Wire protocol of PKU harness Cloud (schemas, envelope crypto, share links) |
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

## Community

- Questions and ideas: [Discussions](https://github.com/pkuinfo/pku-harness/discussions) in the app repository
- A campus service broke, or you want a new one: [issues](https://github.com/pkuinfo/pku-harness-plugins/issues/new/choose)
- Good places to start: [`good first issue`](https://github.com/pkuinfo/pku-harness-plugins/labels/good%20first%20issue)
  and [`help wanted`](https://github.com/pkuinfo/pku-harness-plugins/labels/help%20wanted)
- Where to ask what: [SUPPORT.md](SUPPORT.md)

## Security

PKU harness handles campus credentials. Please report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), never in a public issue.

## Related repositories

| Repository | Role |
|---|---|
| [pkuinfo/pku-harness](https://github.com/pkuinfo/pku-harness) | The app (Expo / React Native) |
| [pkuinfo/pkuharness-website](https://github.com/pkuinfo/pkuharness-website) | Website, developer docs and marketplace |
| [pkuinfo/pkucli](https://github.com/pkuinfo/pkucli) | Command-line tools for PKU services: the protocol reference for plugins |

## License

[MIT](LICENSE) © pkuinfo contributors
