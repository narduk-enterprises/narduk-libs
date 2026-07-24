# @narduk-enterprises/narduk-seo

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
