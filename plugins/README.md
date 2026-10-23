# @pku-harness/plugins

The plugins bundled in the PKU Harness app, one folder each: campus services (wallet, finance,
courses, grades, elective, treehole, library, room booking, …), the dashboard and schedule tabs,
memory, the scheduler and the model providers.

```ts
import { builtinPlugins } from '@pku-harness/plugins';
```

Bundled plugins ship inside the app binary (stores forbid downloading code); community plugins
run as remote MCP servers instead. Campus protocols are ported from
[pkucli](https://github.com/pkuinfo/pkucli). Peer dependencies: `@pku-harness/sdk`, `react`,
`react-native`, `zod`, `@ai-sdk/openai-compatible`.

## Part of PKU Harness

[PKU Harness](https://github.com/pkuinfo/pku-harness) is an open-source, AI-native campus app for
Peking University students. This package lives in [`plugins`](https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins) of
[pku-harness-plugins](https://github.com/pkuinfo/pku-harness-plugins), which holds the SDK, every plugin and the marketplace; see its
[repository map](https://github.com/pkuinfo/pku-harness-plugins#repository-map). All `@pku-harness/*` packages share one version and ship
TypeScript source. Issues: https://github.com/pkuinfo/pku-harness-plugins/issues · License: MIT.
