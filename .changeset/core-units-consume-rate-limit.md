---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

`consumeRateLimit(event, options, path?)`: `defineRateLimitedHandler`'s decision step as a non-throwing verdict, for a route the app cannot wrap, such as a module's token route (#413). The wrapper now calls it, so the two share one counter key, store, binding and override surface.

`shared/utils/units` adds knots (`metresPerSecondToKnots`, `knotsToMetresPerSecond`), the inverse of every existing conversion, and `compassPoint16(degrees)` with `NE_COMPASS_POINTS_16` (#518).
