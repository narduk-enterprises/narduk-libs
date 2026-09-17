---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-logging': patch
'@narduk-enterprises/narduk-realtime': patch
'@narduk-enterprises/narduk-mapkit-nuxt': patch
---

Declare `@nuxt/schema` as a peer dependency in every package whose **published**
files name it. It was a phantom dependency in all four: declared only as a
`devDependency`, while the shipped artifact imports it by bare specifier —
narduk-core's `src/module.ts` (published through `files`), narduk-logging's
`dist/nuxt.d.ts`, narduk-realtime's `dist/module.d.ts`, and narduk-mapkit-nuxt's
`dist/module.d.mts` and `dist/types.d.mts`.

Nothing supplied it to a consumer. `@nuxt/kit@4.5.2` imports `NuxtModule` from
`@nuxt/schema` in its own `index.d.mts` but declares no `dependencies` entry for
it and no peers at all, so resolution worked only through pnpm's hidden
`node_modules/.pnpm/node_modules` hoist or a flat npm/yarn install. A consumer
on pnpm with a restricted `hoist-pattern`, or a `node-linker` setting that
suppresses that hoist, got `TS2307: Cannot find module '@nuxt/schema'` when
type-checking against these packages.

Rewriting the import to `nuxt/schema` — a subpath of the already-declared `nuxt`
peer — was tried and rejected. narduk-realtime has no `nuxt` devDependency, so
`tsc` fails with TS2307 against `nuxt/schema` until one is added, and
narduk-logging declares no `nuxt` peer at all (its Nuxt entry point rests on an
optional `@nuxt/kit` peer), so `nuxt/schema` would have been exactly as
undeclared there as `@nuxt/schema` is today. A `dependencies` entry was rejected
too: the repo augments `@nuxt/schema`'s interfaces, so the consumer must resolve
the same instance its own Nuxt does, which only a peer guarantees.

Each range mirrors the package's existing Nuxt peer — `>=3.16.0` for narduk-core
and narduk-realtime, `>=4.0.0` for narduk-mapkit-nuxt, and `^4.0.0` for
narduk-logging, matching its `@nuxt/kit` peer. narduk-logging's is **optional**,
exactly as its `@nuxt/kit` peer is, so a consumer using only the node, browser
or h3 entry points installs nothing extra. `@nuxt/schema` ships as a dependency
of `nuxt` itself, so any Nuxt app already has a satisfying copy and this
declaration adds no install.

No source file changes: the explicit `NuxtModule` annotations that solved TS2742
are untouched, and the emitted types are byte-identical.
