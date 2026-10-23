# @pku-harness/campus-card

Peking University Campus Card (bdcard.pku.edu.cn) API helpers shared by PKU Harness plugins:
payment code, card mode and transactions. Ported from
[pkucli `crates/campuscard`](https://github.com/pkuinfo/pkucli). Requests go through the host's
campus session (`@pku-harness/sdk` `services.campus`), so this package never handles passwords.

## Part of PKU Harness

[PKU Harness](https://github.com/pkuinfo/pku-harness) is an open-source, AI-native campus app for
Peking University students. This package lives in [`packages/campus-card`](https://github.com/pkuinfo/pku-harness-plugins/tree/main/packages/campus-card) of
[pku-harness-plugins](https://github.com/pkuinfo/pku-harness-plugins), which holds the SDK, every plugin and the marketplace; see its
[repository map](https://github.com/pkuinfo/pku-harness-plugins#repository-map). All `@pku-harness/*` packages share one version and ship
TypeScript source. Issues: https://github.com/pkuinfo/pku-harness-plugins/issues · License: MIT.
