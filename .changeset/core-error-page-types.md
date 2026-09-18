---
'@narduk-enterprises/narduk-core': patch
---

The `./app/error-page` export now has a `types` condition (narduk-libs#521). The
page is typed as a component taking `error: NuxtError`, so an app importing it
into its own `app/error.vue` no longer needs `@ts-expect-error`.
