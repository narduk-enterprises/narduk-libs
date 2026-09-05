# @narduk-enterprises/narduk-mapkit-nuxt

## 2.0.2

### Patch Changes

- 74ca377: Fix `changeset publish` failing to build
  `@narduk-enterprises/narduk-mapkit-nuxt`.

  The package's `tsconfig.json` extends the module-root `.nuxt/tsconfig.json`
  that `nuxt-module-build prepare` generates. The `build` script already ran
  `prepare` first via its `prebuild` hook, but `prepack` (what
  npm/pnpm/changesets run when publishing) had no matching `preprepack` hook, so
  publish-time builds threw
  `TSConfckParseError: failed to resolve "extends":"./.nuxt/tsconfig.json"`
  against a worktree with no prior `nuxt prepare` run. Added
  `"preprepack": "nuxt-module-build prepare"` alongside the existing
  `"prebuild"` script so `prepack` regenerates `.nuxt/` before `unbuild` reads
  the package's tsconfig, matching how `build` already behaves.

## 2.0.1

### Patch Changes

- 33805d0: Moved from the standalone `narduk-mapkit` repository
  (`packages/nuxt`) into `narduk-libs` at `packages/modules/narduk-mapkit-nuxt`,
  with full git history preserved. The package name, version line, module entry
  points and runtime behaviour are unchanged. It now runs the shared
  `@narduk-enterprises/eslint-config`, Prettier, and the Turbo
  `lint`/`typecheck`/`build`/`test:unit`/`check:package` script contract that
  `ci / Required` drives, and it releases through narduk-libs' Changesets
  pipeline instead of its own workflow.
- Updated dependencies [33805d0]
  - @narduk-enterprises/narduk-mapkit@2.0.1
