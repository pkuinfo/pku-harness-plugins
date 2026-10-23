# @pku-harness/registry

The PKU Harness plugin marketplace: the zod schema of an entry and `registry.json`, the index
the app's 插件市场 shows (bundled and remote plugins side by side).

```ts
import { registry, type RegistryEntry } from '@pku-harness/registry';
import index from '@pku-harness/registry/registry.json';
```

To list a plugin, add an entry to `registry/registry.json` in a pull request
([CONTRIBUTING](https://github.com/pkuinfo/pku-harness-plugins/blob/main/CONTRIBUTING.md)).

## Part of PKU Harness

[PKU Harness](https://github.com/pkuinfo/pku-harness) is an open-source, AI-native campus app for
Peking University students. This package lives in [`registry`](https://github.com/pkuinfo/pku-harness-plugins/tree/main/registry) of
[pku-harness-plugins](https://github.com/pkuinfo/pku-harness-plugins), which holds the SDK, every plugin and the marketplace; see its
[repository map](https://github.com/pkuinfo/pku-harness-plugins#repository-map). All `@pku-harness/*` packages share one version and ship
TypeScript source. Issues: https://github.com/pkuinfo/pku-harness-plugins/issues · License: MIT.
