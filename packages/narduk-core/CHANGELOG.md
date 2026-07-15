# @narduk-enterprises/narduk-core

## 1.20.0

### Minor Changes

- 7848187: Remove template composition and Command-only contracts from
  `narduk-platform`, retire core PWA and control-plane behavior, and source the
  SEO network directory from the independent catalog origin.

### Patch Changes

- 7848187: Replace the template-era dynamic database aliases with the private
  `#narduk-core/schema` and `#narduk-core/postgres-runtime` Nuxt contracts. Core
  now derives secure session-cookie defaults from the request protocol so local
  HTTP development remains usable while HTTPS stays secure. Auth's packaged
  runtime now imports its own composables and server helpers explicitly, with
  boundary checks that prevent implicit template-era auto-import dependencies
  from returning.
- 7848187: Keep known VueUse 14.3 annotation noise out of production build logs
  without hiding app-source warnings, and make packaged SEO routes and Takumi
  rendering self-contained in downstream Nuxt consumers.
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-platform@2.0.0
