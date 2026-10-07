---
'@narduk-enterprises/create-narduk-app': patch
---

A freshly scaffolded app floors `shell-quote` at `^1.11.0` (GHSA-pqg4-j6r4-53mv, critical, published 2026-10-07, reaches an app through nuxt's `launch-editor`) and `source-map-js` at `^1.2.2` in the root `pnpm.overrides`, beside the existing `simple-git`, `@simple-git/argv-parser` and `sharp` floors, so a new app's dependency audit stays green. Apps already scaffolded carry their own overrides; `create-narduk-app upgrade` does not touch them.
