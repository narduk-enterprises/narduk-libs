---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/narduk-mapkit-nuxt': patch
'@narduk-enterprises/narduk-realtime': patch
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/narduk-testkit': patch
---

Patch release alongside the `@narduk-enterprises/narduk-logging` minor release
(request ID `cf-ray` fallback, `Server-Timing` emitter, slow-route logging) so
`@narduk-enterprises/create-narduk-app` can refresh its pinned `narduk-logging`
version in `src/manifest.ts` (`scripts/check-generator-release-plan.mjs`
requires a generator release whenever a package it pins changes version). No
generator behavior changes. `narduk-app-tools`, `narduk-mapkit-nuxt`,
`narduk-realtime`, `narduk-shell`, and `narduk-testkit` release together with
the generator per the workspace's own linked-release contract; none of them
changed.
