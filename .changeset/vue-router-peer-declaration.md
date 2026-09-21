---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Declare `vue-router` as a peer dependency of narduk-core.

`runtime/app/components/app/LayerAppHeader.vue` imports the type
`RouteLocationRaw` from `vue-router`, and `runtime/` is in narduk-core's
published `files`, so that bare specifier ships to every consumer. narduk-core
declared `vue-router` nowhere — not in `dependencies`, not in `peerDependencies`
— so it resolved only because `vue-router` is a dependency of `nuxt` (`^5.2.0`
per `nuxt@4.5.2`'s own `package.json`), which every consumer has today. A pnpm
install with a restricted `hoist-pattern`, or a `node-linker` setting that
suppresses that hoist, would get `TS2307: Cannot find module 'vue-router'`.

Same shape as the `@nuxt/schema` phantom dependency closed in #382 — it was
found by that PR's published-surface scan and deliberately left out to keep that
PR scoped (narduk-libs#383). The range mirrors what `nuxt@4.5.2` itself
declares, so any Nuxt app already has a satisfying copy and this declaration
adds no install.

`@narduk-enterprises/create-narduk-app` moves in lockstep because it pins
narduk-core's version in `PACKAGE_VERSIONS`.

**Consumer impact.** `patch`, not `minor`: this declares a dependency that was
already required at runtime for every consumer today (any app using narduk-core
already brings in `nuxt`, which already brings in `vue-router` — narduk-core's
own type import has always needed it to resolve), it does not add a new runtime
requirement. A consumer already on `vue-router >=5.2.0` — which is every
consumer today, since that is what `nuxt@4.5.2` itself pulls in — sees no
change: no new install, no version bump forced on their lockfile, no new peer
warning. A consumer on an older, unsupported `nuxt` that resolved a pre-5.2.0
`vue-router` would newly see a peer range warning on their next install,
surfacing a version this package already silently depended on rather than
creating a new one.
