---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

core: answer `HEAD` on file-based API routes

h3's router matches the request method exactly, so a `*.get.ts` file route
registers `handlers.get` and nothing else and every `HEAD` to an API path fell
through to a 404 — including `/api/health`, the path apps enrol for uptime
monitoring. A monitor probing with `HEAD`, the conventional choice for a
liveness check, saw the app as down. RFC 9110 §9.3.2 requires `HEAD` to be
identical to `GET` minus the body.

A new server middleware answers `HEAD` on `/api` paths by re-entering the app
with `GET` and returning that response's status and headers with no body, so the
two cannot drift and a failing health check still surfaces as its real status
rather than as a cheap `200`. Pages are untouched: the Nuxt renderer is bound to
no method and already answers `HEAD`.

The re-entering request carries the caller's identity. Headers already forwarded
survive the hop untouched; a caller identified only by its socket has that
address carried inward explicitly, because the inner request has no socket and
would otherwise join every other `HEAD` in the single `'unknown'` rate-limit
bucket. A client-chosen forwarded address is never promoted to the trusted
identity header.
