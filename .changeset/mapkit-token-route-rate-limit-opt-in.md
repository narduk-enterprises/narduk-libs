---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

The Nuxt module's `/api/mapkit-token` route now applies **no rate limit by
default** (narduk-libs#485). Since #436 it limited every app to 30 requests per
60 s per routed origin; that ceiling is now opt-in. `ModuleOptions.rateLimit` is
optional and has no default: set
`nardukMapKit: { rateLimit: { limit, windowSeconds } }` to keep a ceiling. A
limiter an app mounts on `event.context.nardukMapKit.rateLimit` still wins, with
or without the option. With per-client keying of the default no longer needed,
narduk-libs#512 is moot.

Logan's decision (askme, 2026-09-18 14:23 CT): "whatever the least restrcitive
reasonable option is.....i do NOT want rate limits to come up again....its super
annoying and not a problem".

`create-narduk-app` picks up the generator-owned narduk-mapkit pin.
