# @pku-harness/sdk

The plugin contract for PKU Harness. A plugin is a typed object built with `definePlugin` and `defineTool`:
tools (zod input/output, an `effect` of `read` | `write` | `money` | `public`), data sources for
widgets and scheduled checks, optional screens, widgets, commands and model providers. Plugins
reach the device only through `ctx.services` (`HostServices`) and draw UI with `HostUI`, so the
same plugin works for the user (a tap) and the agent (a tool call).

Also included, pure and tested: the recurrence engine, schedule input parsing, the timetable
model, scheduled-check conditions and policy, formatting and i18n helpers.

```ts
import { definePlugin, defineTool } from '@pku-harness/sdk';
```

Start from a bundled plugin in [`plugins/`](https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins)
or, for a plugin that runs on your own server, the
[remote template](https://github.com/pkuinfo/pku-harness-plugins/tree/main/templates/remote-plugin).

## Part of PKU Harness

[PKU Harness](https://github.com/pkuinfo/pku-harness) is an open-source, AI-native campus app for
Peking University students. This package lives in [`packages/sdk`](https://github.com/pkuinfo/pku-harness-plugins/tree/main/packages/sdk) of
[pku-harness-plugins](https://github.com/pkuinfo/pku-harness-plugins), which holds the SDK, every plugin and the marketplace; see its
[repository map](https://github.com/pkuinfo/pku-harness-plugins#repository-map). All `@pku-harness/*` packages share one version and ship
TypeScript source. Issues: https://github.com/pkuinfo/pku-harness-plugins/issues · License: MIT.
