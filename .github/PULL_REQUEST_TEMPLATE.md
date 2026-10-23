## Summary

<!-- What does this change and why? Link the issue: "Closes #123". -->

## Type

- [ ] Fix for a broken campus service
- [ ] New plugin
- [ ] Port of a TypeScript plugin to a plugin document
- [ ] SDK / plugin language
- [ ] Registry entry
- [ ] Docs / CI / other

## Checklist

- [ ] `bun run verify` passes (typecheck, registry, bundled documents, all tests)
- [ ] Changed plugin documents have recorded tests (`tests/*.yaml`) for the main and error paths, and `bun run bundle` was run
- [ ] Tool effects are declared honestly (`read` / `write` / `money` / `public`); payments and public posts cannot skip confirmation
- [ ] Campus services, hosts and abilities are declared in `PLUGIN.md`; nothing else is reached
- [ ] No passwords, cookies, tokens or personal data in code, results, fixtures, logs or screenshots
- [ ] Third-party text is returned as data (`untrusted: true` where it applies), never as instructions
- [ ] Protocols ported from pkucli cite the source file
- [ ] User-facing strings have English translations (`i18n.en`); repository text is in English

## Testing

<!-- How did you test against the live service (tool, input, result)? Redact personal data. -->
