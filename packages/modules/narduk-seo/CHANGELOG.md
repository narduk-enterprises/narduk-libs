# @narduk-enterprises/narduk-seo

## 2.2.0

### Minor Changes

- 8abb3c8: Move the bundled Nuxt SEO modules to one coordinated set that
  supports both Unhead 2 (Nuxt 4.4) and Unhead 3 (Nuxt 4.5): `@nuxtjs/robots`
  6.2.3, `@nuxtjs/sitemap` 8.5.1, `nuxt-link-checker` 5.3.0, `nuxt-og-image`
  6.8.0, `nuxt-schema-org` 6.3.2, `nuxt-seo-utils` 8.5.1 and `nuxt-site-config`
  4.2.3. The set no longer installs `image-size`, `@unhead/addons` or
  `@unhead/schema-org`.

  To adopt it, remove app overrides that pin `nuxt-seo-utils`, `nuxt-og-image`,
  `@nuxtjs/seo` or `nuxtseo-shared` to older releases. If the app imports
  `#sitemap/types`, set its own `@nuxtjs/sitemap` to 8.5.1.

  Rendered head changes to expect, all verified against a real app on Nuxt 4.4.8
  and on Nuxt 4.5.2:

  - `nuxt-seo-utils` 8.5 defaults to `minify: { build: true, runtime: false }`,
    so head content injected at runtime (for example Nuxt UI's inline color
    styles) is no longer minified in the SSR response. Set
    `seo: { minify: true }` to keep the old behaviour.
  - `nuxt-seo-utils` 8.5 emits the full favicon set it discovers, with `type`
    and `sizes` attributes, rather than only `apple-touch-icon`.
  - `nuxt-schema-org` 6.3.2 no longer emits a second `#organization` node beside
    the `#identity` one. Assertions that matched the duplicate need updating.
  - `nuxt-seo-utils` 8.5 runs its `treeShakeUseSeoMeta` transform only on Unhead
    3; on Unhead 2 it logs that it skipped the transform.
  - `nuxt-seo-utils` 8.5 adds a build-time head validator that can report
    malformed or duplicate head tags.

  OG image preview paths now carry the signature `nuxt-og-image` verifies, so
  signed previews load when `security.secret` is set. Values containing `*` are
  encoded the way `nuxt-og-image` 6.8.0 encodes them.

### Patch Changes

- Updated dependencies [8f693b1]
- Updated dependencies [8abb3c8]
  - @narduk-enterprises/narduk-core@2.0.0

## 2.1.1

### Patch Changes

- Updated dependencies [2e9d424]
  - @narduk-enterprises/narduk-core@1.25.0

## 2.1.0

### Minor Changes

- fb0c50c: Add app-owned social preview generation and validation: default
  artwork, explicit route coverage, initial HTML checks, crawler image
  downloads, and distinct dynamic route images. The SEO module gains an opt-in
  global static fallback and canonical OG URLs, with explicit previews for
  public noindex pages. New scaffolds include artwork sources, metadata, route
  inventory, build gates, and crawler acceptance. Existing apps opt in through
  the migration guide; no fleet synchronization occurs.

### Patch Changes

- Updated dependencies [548fa01]
- Updated dependencies [960479a]
- Updated dependencies [54577ac]
- Updated dependencies [0f45d4b]
- Updated dependencies [fdb9c15]
- Updated dependencies [3a2b7b0]
- Updated dependencies [d606e70]
  - @narduk-enterprises/narduk-core@1.24.0

## 2.0.10

### Patch Changes

- e202cfd: Disable analytics identifiers, loading, and replay on noncanonical
  Workers/Pages preview hosts and explicit nonproduction deployments. The same
  immutable version keeps production analytics when promoted to its canonical
  hostname.

  Avoid a client lifecycle warning while retaining noindex robots metadata on
  noncanonical hosts.

- Updated dependencies [e202cfd]
- Updated dependencies [37c03e2]
  - @narduk-enterprises/narduk-core@1.23.2

## 2.0.9

### Patch Changes

- Updated dependencies [aaf5549]
  - @narduk-enterprises/narduk-core@1.23.1

## 2.0.8

### Patch Changes

- Updated dependencies [6297a08]
  - @narduk-enterprises/narduk-core@1.23.0

## 2.0.7

### Patch Changes

- Updated dependencies [def589f]
  - @narduk-enterprises/narduk-core@1.22.0

## 2.0.6

### Patch Changes

- Updated dependencies [0f2262a]
- Updated dependencies [8b48dba]
  - @narduk-enterprises/narduk-core@1.21.0

## 2.0.5

### Patch Changes

- Updated dependencies [d6e098e]
  - @narduk-enterprises/narduk-core@1.20.5

## 2.0.4

### Patch Changes

- Updated dependencies [1d017c7]
  - @narduk-enterprises/narduk-core@1.20.4

## 2.0.3

### Patch Changes

- @narduk-enterprises/narduk-core@1.20.3

## 2.0.2

### Patch Changes

- 95ec690: `@narduk-enterprises/eslint-config` v2: the estate lint config moves
  into narduk-libs (per HB-10 / D-DEMOTE-1 and narduk-libs#50), rebuilt for
  ESLint 10 on a replace-by-default basis — maintained third-party plugins
  wherever they cover the intent, 45 bespoke rules surviving out of 103 (every
  one with tests and no `testMode` bypasses), the proven-inverted hydration
  rules and dead Nitro security gates rebuilt against the executed deep-review
  proofs, legacy presets and the frozen nuxt-ui spec tier removed, and every
  code-corrupting autofixer gone. Consumer API (`createAppLintConfig`,
  `composeSharedConfigs`, the 14 capability packs) is signature-compatible;
  adopting v2 requires ESLint `^10` (peer). License corrected to UNLICENSED
  (D-PKG-5).

  **Three consumer-visible tightenings** land with the adversarial-hardening
  pass (full account in `DESIGN.md`):

  1. **Pack globs are nesting-safe.** `server/**`, `workers/**` and the auth
     pack's globs now match at any depth. A repository linted from an outer
     `cwd` — any monorepo, any app one level down, and every layer package's
     `runtime/server/**` — previously received **no** server or Cloudflare rules
     at all. Expect first-time findings in newly-covered trees. The two core
     rules the packs carry are gated out of `tests/**` and friends so the
     widening does not sweep in test code.
  2. **A route named like a test is a route.** `server/api/x.post.test.ts` is
     deployed by Nitro as `POST /api/x.post.test`, and the `.test.` infix no
     longer exempts it from the security tier. Inside a route tree only a real
     test or fixture _directory_ exempts a file. Move colocated route suites
     under `tests/` or `__tests__/`.
  3. **`no-restricted-imports` is order-independent.** All three contributing
     packs now assign one shared option, so a trailing `cloudflare` entry can no
     longer erase the relative-import and layer-source patterns — which it did
     for every consumer using `nardukTemplateStrictCapabilityPacks`. Those
     patterns start applying again. A portable Nuxt layer (no `#server/*` alias
     for its own sources) should assign the new
     `PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE` export to its server glob rather
     than switching the rule off.

  Also fixed in the same pass: five ways to walk past a security rule by
  renaming a binding (an aliased `defineEventHandler`, a runtime-derived HTTP
  method, `.raw` lifted off drizzle's `sql`, a destructured `db.query` receiver,
  and `limit: undefined`), and `no-legacy-overlay-model`'s blindness to
  camelCase `modelValue` bindings. Every one ships with the fixture that proved
  it as a regression test.

  Sibling packages: the shared config is now consumed via the workspace
  (`workspace:*`) and their `eslint` devDependency moves to `^10.8.0`. Adopting
  v2 also swept their stale `eslint-disable` comments onto the replacement rule
  ids and cleared the findings the fixed path gates newly surface. Three
  behaviour-neutral source edits came with that sweep: `narduk-core` adds
  `import.meta.client` early returns to three handlers that were already
  client-only (clipboard copy, share-link copy, avatar canvas resize);
  `narduk-auth`'s `runtime-public` endpoint drops a `process.env` merge layer
  that `readWorkerRuntimeEnv` already supplied and that the merge order
  discarded; and `narduk-app-tools` swaps one `split().join()` for
  `replaceAll()`. The five layer packages (`narduk-core`, `-auth`, `-seo`,
  `-ai`, `-uploads`) assign the portable-layer import rule in their own configs,
  and `narduk-core` and `-uploads` carry scoped, commented exceptions for the
  pre-existing conditions their newly-linted `runtime/server/**` trees surfaced.

- Updated dependencies [95ec690]
  - @narduk-enterprises/narduk-core@1.20.2

## 2.0.1

### Patch Changes

- Updated dependencies [e030789]
  - @narduk-enterprises/narduk-core@1.20.1

## 2.0.0

### Major Changes

- 256c696: seo: make the Narduk network directory endpoint injectable with no
  default

  The network directory endpoint is now supplied by the consuming app through
  `nardukSeo.networkDirectoryUrl` (or `NUXT_PUBLIC_NARDUK_NETWORK_DIRECTORY_URL`
  at runtime) and has **no built-in default**. When it is unset the feature
  disables itself: `/api/narduk-network/sites` performs no outbound fetch,
  `useNardukNetworkDirectory()` skips its request, `/narduk-network` renders an
  empty directory, and `LayerNetworkFooter` omits the directory link. Failing
  quiet is deliberate — the directory is a marketing cross-link surface, not a
  gate.

  Previously the endpoint was derived from a package-owned catalog hostname, so
  every app installing this package polled a host it never chose. A published
  library must not pin its consumers to one origin.

  BREAKING CHANGES:

  - `NARDUK_DEFAULT_CATALOG_BASE_URL` is no longer exported.
  - `resolveNardukNetworkDirectoryUrl(value)` now takes the full directory URL
    (not a catalog base URL) and returns `null | string` instead of `string`.
  - `resolveNardukCatalogBaseUrl(value)` returns `null | string` instead of
    falling back to a hardcoded hostname.
  - `/api/narduk-network/sites` responses gained `configured: boolean`, and
    `catalogUrl` / `directoryUrl` may now be `null`.
  - Apps that want `/narduk-network` populated must set the new option;
    upgrading without setting it turns the directory off rather than repointing
    it.

### Patch Changes

- e4c8262: Replace implicit reliance on `narduk-core`'s Nuxt auto-imports
  (`useAppFetch`, `formatBuildTimeLocal`, `useLogger`, `requireAdmin`) with
  explicit imports from `@narduk-enterprises/narduk-core/*` subpaths.

  These composables/utils were previously called as bare globals, which only
  resolves when a consuming app registers `narduk-core`'s Nuxt module with its
  default options (`app: true`). A consumer that narrows the module surface (for
  example `{ app: false, server: true }`, used by `spacex-ipo` to avoid a
  component-registration collision with `narduk-seo`'s own `LayerAppFooter`)
  fails `nuxt typecheck` with `Cannot find name 'useAppFetch'` the moment it
  also depends on `narduk-seo` or `narduk-auth`, because those packages'
  composables/components still assumed the global was present.

  No behavior change: each site now imports the exact same function it was
  already calling implicitly.

  Bump `create-narduk-app` in step so its generated-app pins for `narduk-seo`,
  `narduk-auth`, and `narduk-analytics` refresh to these patched versions.

## 1.21.0

### Minor Changes

- 0783806: Add host-aware runtime indexing (`hostAwareIndexing` module option /
  `NARDUK_SEO_HOST_AWARE_INDEXING` env). Production-target builds that opt in
  ship a runtime guard — a nitro middleware plus an app plugin — that serves
  `noindex, nofollow` (response header and robots meta) on any non-canonical
  request host, such as an immutable route-free `workers.dev` preview alias,
  while the canonical site host stays fully indexable. This enables the
  build-once contract where one exact Worker version is preview-safe on its
  preview URL and indexable on the production domain, instead of baking noindex
  into a separate preview build. Non-production deployment targets are unchanged
  (the existing build-time noindex safety still applies), and the feature is off
  by default.

### Patch Changes

- 0783806: Restore a warning-free packed consumer install after upstream Nuxt
  4.5 drift.

  `nuxt-og-image` moves from 6.7.2 to 6.7.4. 6.7.2 pinned `oxc-parser@^0.138.0`,
  which cannot satisfy the `oxc-parser@>=0.140.0` optional peer that `unctx@3`
  declares once `@nuxt/kit@4.5.0` is resolved, so a Nuxt-less external consumer
  install emitted an unmet-peer warning.

  The generated app now pins `@nuxt/kit` to its exact `nuxt` version, and pins
  `nuxt-og-image` to the 6.7.2 release built for that `@nuxt/kit`. The generator
  pins `nuxt` exactly while the Narduk modules depend on `@nuxt/kit@^4.0.0`, so
  before this the app resolved a `@nuxt/kit` newer than its own `nuxt` as soon
  as upstream published a Nuxt minor, and inherited that kit's transitive
  dependency block instead of the one its pinned Nuxt was built with.

## 1.20.0

### Minor Changes

- 7848187: Remove template composition and Command-only contracts from
  `narduk-platform`, retire core PWA and control-plane behavior, and source the
  SEO network directory from the independent catalog origin.

### Patch Changes

- 7848187: Keep known VueUse 14.3 annotation noise out of production build logs
  without hiding app-source warnings, and make packaged SEO routes and Takumi
  rendering self-contained in downstream Nuxt consumers.
- Updated dependencies [7848187]
- Updated dependencies [7848187]
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-core@1.20.0
