# @pku-harness/cloud-protocol

The PKU Harness Cloud wire protocol, v1: zod schemas for every frame, envelope encryption
(Ed25519 + X25519 identities, XChaCha20-Poly1305 payloads via `@noble/*`), share links and proof of work. Pure TypeScript
that runs on Hermes (the app), Bun (the server) and browsers (share pages). The server only
ever sees ciphertext; campus credentials never leave the phone.

Used by the app, the reference server
([`packages/cloud-server`](https://github.com/pkuinfo/pku-harness-plugins/tree/main/packages/cloud-server))
and plugins with a cloud part.

## Part of PKU Harness

[PKU Harness](https://github.com/pkuinfo/pku-harness) is an open-source, AI-native campus app for
Peking University students. This package lives in [`packages/cloud-protocol`](https://github.com/pkuinfo/pku-harness-plugins/tree/main/packages/cloud-protocol) of
[pku-harness-plugins](https://github.com/pkuinfo/pku-harness-plugins), which holds the SDK, every plugin and the marketplace; see its
[repository map](https://github.com/pkuinfo/pku-harness-plugins#repository-map). All `@pku-harness/*` packages share one version and ship
TypeScript source. Issues: https://github.com/pkuinfo/pku-harness-plugins/issues · License: MIT.
