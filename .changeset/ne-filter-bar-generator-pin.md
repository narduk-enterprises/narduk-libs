---
'@narduk-enterprises/create-narduk-app': patch
---

Re-release so the generator's `@narduk-enterprises/narduk-shell` pin moves with
that package's `NeFilterBar` release (0.4.0 → 0.5.0).

The pin literal in `src/manifest.ts` is deliberately not hand-edited here:
`versions:check` requires it to equal narduk-shell's **live** `package.json`
version rather than a preview of its next one, so `versions:sync` re-pins it
when `release:version` actually runs. This changeset is what makes that release
happen in the same wave, which is what `release-plan:check` asks for.
