# Security Policy

PKU Harness stores campus credentials, the IAAA authenticator secret and AI service keys on the
user's phone, and lets an AI agent act on campus services on the user's behalf. Plugins are the
code (or documents) that reach those services, so we take security reports very seriously.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting:

- Plugins, the SDK, the plugin language or the registry:
  <https://github.com/pkuinfo/pku-harness-plugins/security/advisories/new>
- The app itself: <https://github.com/pkuinfo/pku-harness/security/advisories/new>

Please include the affected component and version (or commit), steps to reproduce, the impact
you see, and your severity estimate. **Never include real account names, passwords, tokens,
cookies or personal data**: use test data or redact them.

We acknowledge reports within 7 days, keep you informed while we fix the issue, and credit you in
the release notes if you wish.

## Supported versions

Security fixes go to the latest release of the app and to the `main` branch of this repository.
Official plugin documents update over the air from their links, so fixes reach users without an
app release.

## Scope

In scope:

- **Credential exposure**: passwords, authenticator secrets, cookies, session tokens or API keys
  appearing outside the device's secure storage (logs, exports, crash reports, network requests,
  tool results).
- **Plugin sandbox escapes**: a plugin reaching a campus service, host or app feature it did not
  declare, another plugin's data, or bypassing the per-effect permissions (read / write / money /
  public).
- **Interpreter flaws**: plugin-language expressions or steps escaping their limits or reaching
  JavaScript internals.
- **Prompt injection**: campus content (treehole posts, notices) making the agent take actions
  the user did not authorize.
- **Unconfirmed payments or public posts.**
- **Supply chain**: the marketplace registry, plugin update links, remote (MCP) plugins.

Out of scope:

- Vulnerabilities in the university's own services (please report those to the university).
- Attacks that require a rooted or jailbroken device, or physical access to an unlocked phone.
- Missing security headers on static pages without a demonstrated impact.
