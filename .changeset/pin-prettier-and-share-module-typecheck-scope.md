---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-tenancy': patch
'@narduk-enterprises/create-narduk-app': patch
---

Publish the server-only module package Nuxt config fragment once as
`@narduk-enterprises/narduk-core/nuxt-module-package-config`, and consume it
from `narduk-tenancy`. A `packages/modules/*` package that ships no `app/` tree
and sets no explicit `srcDir` keeps the package root as srcDir, so
`nuxt typecheck` otherwise pulls `eslint.config.mjs` and the untyped `.mjs`
sources of `@narduk-enterprises/eslint-config` into the type project
(narduk-libs#176).

Pin `create-narduk-app`'s own `prettier` devDependency to the one workspace
version (`3.9.4`). Its published manifest declared the exact `3.8.3`, so a
consumer installing it from the packed artifact — outside the workspace where
`pnpm.overrides` applies — resolved a prettier that formats a multi-member union
differently from CI, re-creating narduk-libs#175 one hop out.
