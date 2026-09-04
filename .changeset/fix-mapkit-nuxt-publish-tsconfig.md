---
'@narduk-enterprises/narduk-mapkit-nuxt': patch
---

Fix `changeset publish` failing to build
`@narduk-enterprises/narduk-mapkit-nuxt`.

The package's `tsconfig.json` extends the module-root `.nuxt/tsconfig.json` that
`nuxt-module-build prepare` generates. The `build` script already ran `prepare`
first via its `prebuild` hook, but `prepack` (what npm/pnpm/changesets run when
publishing) had no matching `preprepack` hook, so publish-time builds threw
`TSConfckParseError: failed to resolve "extends":"./.nuxt/tsconfig.json"`
against a worktree with no prior `nuxt prepare` run. Added
`"preprepack": "nuxt-module-build prepare"` alongside the existing `"prebuild"`
script so `prepack` regenerates `.nuxt/` before `unbuild` reads the package's
tsconfig, matching how `build` already behaves.
