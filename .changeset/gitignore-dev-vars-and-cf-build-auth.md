---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-app-tools': patch
---

Ignore generated Wrangler `.dev.vars` secrets, and make `cf:build` authenticate
before it installs.

The scaffolded `.gitignore` now lists `.dev.vars` / `**/.dev.vars` /
`.dev.vars.*` with a `!.dev.vars.example` carve-out, matching the existing
`.env` pattern. Root `cf:build` runs a committed `scripts/gh-packages-run.mjs`
(process-scoped temp userconfig from `GH_PACKAGES_READ`, then
`pnpm install --frozen-lockfile`) so a Workers Builds dashboard that sets
`SKIP_DEPENDENCY_INSTALL=1` actually has `node_modules` and registry auth before
`nuxt build`. `narduk-app gh-packages-run` is the same helper for post-install
callers.
