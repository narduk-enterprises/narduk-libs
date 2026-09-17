# @narduk-enterprises/narduk-mapkit-nuxt

## 2.0.6

### Patch Changes

- 57ba098: Declare `@nuxt/schema` as a peer dependency in every package whose
  **published** files name it. It was a phantom dependency in all four: declared
  only as a `devDependency`, while the shipped artifact imports it by bare
  specifier — narduk-core's `src/module.ts` (published through `files`),
  narduk-logging's `dist/nuxt.d.ts`, narduk-realtime's `dist/module.d.ts`, and
  narduk-mapkit-nuxt's `dist/module.d.mts` and `dist/types.d.mts`.

  Nothing supplied it to a consumer. `@nuxt/kit@4.5.2` imports `NuxtModule` from
  `@nuxt/schema` in its own `index.d.mts` but declares no `dependencies` entry
  for it and no peers at all, so resolution worked only through pnpm's hidden
  `node_modules/.pnpm/node_modules` hoist or a flat npm/yarn install. A consumer
  on pnpm with a restricted `hoist-pattern`, or a `node-linker` setting that
  suppresses that hoist, got `TS2307: Cannot find module '@nuxt/schema'` when
  type-checking against these packages.

  Rewriting the import to `nuxt/schema` — a subpath of the already-declared
  `nuxt` peer — was tried and rejected. narduk-realtime has no `nuxt`
  devDependency, so `tsc` fails with TS2307 against `nuxt/schema` until one is
  added, and narduk-logging declares no `nuxt` peer at all (its Nuxt entry point
  rests on an optional `@nuxt/kit` peer), so `nuxt/schema` would have been
  exactly as undeclared there as `@nuxt/schema` is today. A `dependencies` entry
  was rejected too: the repo augments `@nuxt/schema`'s interfaces, so the
  consumer must resolve the same instance its own Nuxt does, which only a peer
  guarantees.

  Each range mirrors the package's existing Nuxt peer — `>=3.16.0` for
  narduk-core and narduk-realtime, `>=4.0.0` for narduk-mapkit-nuxt, and
  `^4.0.0` for narduk-logging, matching its `@nuxt/kit` peer. narduk-logging's
  is **optional**, exactly as its `@nuxt/kit` peer is, so a consumer using only
  the node, browser or h3 entry points installs nothing extra. `@nuxt/schema`
  ships as a dependency of `nuxt` itself, so any Nuxt app already has a
  satisfying copy and this declaration adds no install.

  No source file changes: the explicit `NuxtModule` annotations that solved
  TS2742 are untouched, and the emitted types are byte-identical.

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
