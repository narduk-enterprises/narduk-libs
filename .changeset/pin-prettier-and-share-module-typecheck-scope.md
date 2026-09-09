---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-tenancy': patch
---

Publish the server-only module package Nuxt config fragment once as
`@narduk-enterprises/narduk-core/nuxt-module-package-config`, and consume it
from `narduk-tenancy`. A `packages/modules/*` package that ships no `app/` tree
and sets no explicit `srcDir` keeps the package root as srcDir, so
`nuxt typecheck` otherwise pulls `eslint.config.mjs` and the untyped `.mjs`
sources of `@narduk-enterprises/eslint-config` into the type project
(narduk-libs#176).
