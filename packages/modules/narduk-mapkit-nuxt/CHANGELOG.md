# @narduk-enterprises/narduk-mapkit-nuxt

## 2.0.5

### Patch Changes

- 9217002: Add a mount test for `AppMapKit`'s callout wiring (`selectedId`
  open/close, `calloutMode`/`calloutPlacement` forwarding, Escape-dismiss
  syncing back to `selectedId`) via a new `isClientEnvironment()` seam around
  the `import.meta.client` guard in `ensureCalloutController()`. No production
  behavior changes — the seam still reads the same macro — this only makes the
  client-only branch reachable from a plain Vite/vitest mount test.
- 837c1eb: Backfill `AppMapKit` to the shared component suite bar: README props,
  slots, events and example, plus a happy-dom mount test and a node
  `renderToString` SSR proof. NE Base cards wait for #250.

## 2.0.4

### Patch Changes

- 05515cd: Add the required `mapkit_js` scope to dynamically signed MapKit JS
  tokens so Apple accepts the token at its JavaScript bootstrap endpoint.
- Updated dependencies [05515cd]
  - @narduk-enterprises/narduk-mapkit@2.0.2

## 2.0.3

### Patch Changes

- fbc9504: Fix `changeset publish` still failing to build
  `@narduk-enterprises/narduk-mapkit-nuxt` after the prior 2.0.2 attempt
  (release run 33938838208).

  The prior fix added a `preprepack` script mirroring the package's existing
  `prebuild` hook, on the assumption that npm/pnpm's `pre<script>` chaining
  would run it before `prepack`. That chaining only applies when a script name
  is invoked generically (`pnpm run prepack`); `prepack` is a reserved lifecycle
  event that `npm publish`/`pnpm pack` invoke directly, bypassing it, so
  `preprepack` never ran during the real publish path and the same
  `TSConfckParseError: failed to resolve "extends":"./.nuxt/tsconfig.json"`
  recurred. Folded `nuxt-module-build prepare` directly into the `prepack`
  script itself, verified with a from-clean `pnpm pack --dry-run` and
  `npm pack --dry-run` (not `pnpm run prepack`, which would mask this class of
  bug again).

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
