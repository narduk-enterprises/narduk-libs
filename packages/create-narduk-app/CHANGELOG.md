# @narduk-enterprises/create-narduk-app

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
