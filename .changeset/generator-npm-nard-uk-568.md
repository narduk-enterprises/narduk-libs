---
'@narduk-enterprises/create-narduk-app': patch
---

Generated apps now route `@narduk-enterprises/*` to the anonymous `https://npm.nard.uk` mirror, drop the Dependabot `registries:` block, and install without a GitHub Packages token. `scripts/gh-packages-run.mjs` stays as opt-in break-glass and is unused by the default `cf:build` and CI paths (narduk-libs#568).
