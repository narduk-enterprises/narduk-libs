---
'@narduk-enterprises/narduk-shell': minor
---

Fix the package root (`.`) failing a production `nuxt build` for any app that
imports a documented value export (narduk-libs#295).

`.` used to resolve straight to `src/module.ts`, the Nuxt module definition,
which imports `@nuxt/kit`. Nuxt's import-protection plugin exists precisely to
stop a build-time-only import like that from reaching a client bundle, so
`import { defineStatusMap } from '@narduk-enterprises/narduk-shell'` — exactly
as documented in this README — failed every consuming app's production build.
The first real adopter (`narduk-enterprises/buoys` PR #44) hit this within an
hour of the 0.1.0 publish and worked around it with a hand-copied local shim
(buoys#61) rather than a real fix.

**The fix**: `src/module.ts` now holds only the Nuxt module definition and is
reachable through a new `./module` subpath — internal, not meant for an app to
import directly, but where `@nuxt/kit`'s own `loadNuxtModuleInstance` suffix
resolution (`module`/`module/index`, tried before the bare specifier) finds it
via an unchanged `modules: ['@narduk-enterprises/narduk-shell']`. `.` is now
`src/index.ts`, a new barrel that re-exports the exact values and types `.`
always documented (`defineStatusMap`, `NARDUK_SHELL_APP_CONFIG`, and the suite's
public types) and never imports `@nuxt/kit` or `src/module.ts` by value — a
dedicated "root barrel reachability" test (`test/module.test.ts`) walks its
value-import graph and fails the moment either becomes reachable again.

This was chosen over changing what a consumer writes: both documented entry
points keep working completely unchanged —
`modules: ['@narduk-enterprises/narduk-shell']` in `nuxt.config.ts`, and
`import { defineStatusMap } from '@narduk-enterprises/narduk-shell'` — so no
adopter has to touch an import specifier, and buoys's local shim (buoys#61) can
be deleted once this ships.

`scripts/release-packages.mjs`'s packed-consumer-smoke pipeline now also
generates an app page that imports `defineStatusMap` and
`NARDUK_SHELL_APP_CONFIG` as values from the package root and asserts (via
Playwright) that they render correctly — closing the actual gap: the pipeline's
existing checks proved the packed tarball installs, not that a documented root
import survives a real `nuxt build`.
