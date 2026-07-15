# @narduk-enterprises/narduk-auth

## 1.19.27

### Patch Changes

- 7848187: Replace the template-era dynamic database aliases with the private
  `#narduk-core/schema` and `#narduk-core/postgres-runtime` Nuxt contracts. Core
  now derives secure session-cookie defaults from the request protocol so local
  HTTP development remains usable while HTTPS stays secure. Auth's packaged
  runtime now imports its own composables and server helpers explicitly, with
  boundary checks that prevent implicit template-era auto-import dependencies
  from returning.
- Updated dependencies [7848187]
- Updated dependencies [7848187]
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-core@1.20.0
