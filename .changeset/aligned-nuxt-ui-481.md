---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/narduk-ai': patch
'@narduk-enterprises/design-system-build': patch
'@narduk-enterprises/create-narduk-app': patch
---

Pin `@nuxt/ui` at `4.8.1` everywhere the layer pins it: the `narduk-core`
dependency, the `narduk-shell` peer and dev pins, the `narduk-ai` and
`design-system-build` dev pins, and the `create-narduk-app` generator manifest.

`@nuxt/ui` 4.6.1 added `build.transpile.push('reka-ui')` (nuxt/ui#6286), which
makes Vite bundle `reka-ui` per importer on the server as well as the client.
Without it, an app that also declares `reka-ui` directly renders SSR markup from
its own copy while hydrating against Nuxt UI's pinned copy, which produced the
`Hydration node mismatch` failures in buoys. 4.8.1 also carries the fix for
GHSA-gj2h-2fpw-fhv9 (medium, `@nuxt/ui < 4.8.1`) and widens the `typescript`
peer to `^5.6.3 || ^6.0.0`. The only breaking change between 4.6.0 and 4.8.1 is
`UInputMenu`'s `autocomplete` prop being renamed to `mode`, which nothing in
this workspace uses.

Consumer migration: an app that declares `@nuxt/ui` itself must move its own pin
to `4.8.1` in the same change that takes this release. `narduk-shell`'s peer is
exact, so any other version is a peer conflict, and `narduk-core` carries
`@nuxt/ui` as a dependency, so a different app-level pin resolves a second copy
— the duplicate-copy failure this release removes.
