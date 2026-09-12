---
'@narduk-enterprises/create-narduk-app': minor
---

Generated apps collapse every workspace-published estate pin, and run
`foundation:check:shared-ui-pinned` (narduk-libs#282 review).

- **`pnpm.overrides` regains `@narduk-enterprises/narduk-core` and gains
  `narduk-logging`, `narduk-platform` (always) and `narduk-mapkit` (mapkit
  capability).** pnpm replaces a `workspace:` specifier with the _exact_ version
  of that workspace package at publish time, so a published estate package
  carries a hard pin on whatever its sibling's version was that day. Two
  different exact pins on one package in one tree is two installed copies — for
  a Nuxt module two registrations and two `useRuntimeConfig` namespaces, for a
  contracts package two copies of the zod schemas its consumers are supposed to
  share. Two shapes produce that second pin: **one publisher plus the app's own
  direct pin** (`narduk-core` ships `narduk-logging: workspace:*`;
  `narduk-mapkit-nuxt` ships `narduk-mapkit: workspace:*`), and **two or more
  publishers with no direct pin at all** — `narduk-platform` is a runtime
  `workspace:*` dependency of `narduk-core`, `narduk-ai` _and_ `narduk-auth`
  while a generated app names it nowhere. `narduk-core` is both at once (four
  publishers and a direct pin). A package with one publisher and no direct pin
  needs no override and gets none, which is why `narduk-app` (shipped by
  `narduk-auth` alone) is absent; `@narduk-enterprises/narduk-auth` is absent
  because nothing in the estate depends on it, so its override was inert. The
  accepted cost is that Dependabot does not update `pnpm.overrides`, so a
  grouped bump resolves back to the override until it is bumped by hand: a stale
  single copy is recoverable, two live copies are not. An override also asserts
  the estate is mutually compatible at the pinned versions; `versions:sync`
  keeps those pins on the workspace versions, which is the set built and tested
  together. A new test derives the whole set from the live workspace manifests —
  publishers counted over the installed closure, direct pins intersected,
  devDependency edges excluded because a published package's devDependencies are
  never installed by its consumers — so a new `workspace:` edge cannot reopen
  the hole silently.
- **New scripts `foundation:shared-ui-pinned` (root and `apps/web`), wired into
  `quality:static`.** The command reads manifests only and needs no registry
  credential, so it runs where the generated install step has already dropped
  the GitHub Packages token. narduk-libs' own `packed-consumer-smoke` job
  expands the generated `quality` chain, so the check also runs against a
  really-installed generated app on every narduk-libs PR. The generated CI for a
  **private** app calls the shared `nuxt-cloudflare.yml` workflow rather than
  `quality:static`, so `foundation:shared-ui-pinned` is named in its
  `extra-scripts` too — otherwise that half of the fleet would ship the script
  and never run it.
