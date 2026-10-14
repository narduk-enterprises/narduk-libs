---
'@narduk-enterprises/narduk-core': patch
---

`useAppFetch` type-checks on Nuxt 4.6.x as well as 4.5.x. Nuxt 4.6 narrowed the `method` and `baseURL` options of `useRequestFetch()`, so the helper's inner `requestFetch<T>(request, opts)` call failed `nuxt typecheck` in consumers (TS2769). The inner call is now loosened; the helper's public signature is unchanged. A test typechecks the shipped helper in a scratch app on the latest Nuxt.
