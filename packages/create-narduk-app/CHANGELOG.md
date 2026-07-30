# @narduk-enterprises/create-narduk-app

## 0.1.7

### Patch Changes

- d22cd3d: Import Nuxt runtime helpers explicitly in packaged analytics plugins
  so consumer builds hydrate without relying on ambient package-source
  auto-import transforms.

## 0.1.6

### Patch Changes

- e030789: Configure the local Lucide server and core-header client bundles
  before Nuxt UI installs its icon module, and generate the core module before
  Nuxt UI so that ordering remains deterministic in packed consumers.

## 0.1.5

### Patch Changes

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

## 0.1.4

### Patch Changes

- 0783806: Track the @narduk-enterprises/narduk-seo minor (host-aware runtime
  indexing) in generator-owned package pins.
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

## 0.1.3

### Patch Changes

- a783f18: Ignore stale package-manager entrypoints and fall back to the
  executable installed in `PNPM_HOME`, keeping repeated migration runs
  independent of `PATH`.

  Update generated-app package pins for the corrected app-tools release.

## 0.1.2

### Patch Changes

- 435cc56: Run Wrangler through the package manager entrypoint that launched
  `narduk-app`, avoiding PATH-dependent migration failures on repeated CI
  invocations.

  Update generated-app package pins for the corrected app-tools release.

## 0.1.1

### Patch Changes

- 7848187: Publish the generator with the exact neutralized package versions
  produced by this release.
