# @narduk-enterprises/narduk-mapkit-nuxt

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
