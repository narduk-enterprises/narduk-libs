---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `@narduk-enterprises/narduk-mapkit/testing`: a deterministic, offline fake
of MapKit JS v6 for component and end-to-end tests.

The fake is modelled on a measured spike against real MapKit JS 6.0.128 rather
than on the documentation alone. It covers `load()` with library gating,
`init()` with the `configuration-change` and `error` events (Apple's seven
`ConfigurationErrorStatus` values verbatim), scriptable authorization outcomes
including the measured origin-mismatch shape (the same token retried three
times, `authorizationCallback` invoked exactly once, then `Unauthorized`), an
injected access-key clock, `mapkit.Map`, the three annotation classes, and the
value types. Anything it does not model throws
`FakeMapKitNotImplemented: <member>` instead of silently answering `undefined`.

A separate inspection surface records an operation log with per-annotation
add/remove counts, so a component test can assert a reconciliation budget --
"updating 1 of 600 pins touched 1 annotation, not 600" -- rather than only a
final-state outcome. `fakeMapKitInitScript()` serialises the whole fake for
Playwright's `page.addInitScript`; it is one self-contained function, so there
is no bundler step and no second implementation.

`./testing` is a dev-time export: it carries no runtime dependency, and an
import-graph test asserts no production entry point can reach it. The fake's
public types are declared structurally, so the published `.d.ts` resolves
without Apple's types installed, while a type-level conformance suite compares
it member by member against `@types/apple-mapkit` v6 and fails typecheck on
drift.

`@narduk-enterprises/create-narduk-app` gets a patch release so it can refresh
its pinned `narduk-mapkit` version in `src/manifest.ts`
(`scripts/check-generator-release-plan.mjs` requires a generator release
whenever a package it pins changes version). No generator behavior changes.
