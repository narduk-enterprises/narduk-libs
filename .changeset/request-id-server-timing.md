---
'@narduk-enterprises/narduk-logging': minor
---

Add end-to-end request-ID propagation and per-request Server-Timing to
`narduk-logging`'s `h3` and `worker` adapters.

`requestId` now accepts a `cf-ray` fallback seed, so a request that never sent
its own correlation ID still lines up with Cloudflare's own edge trace instead
of getting a disconnected UUID. `requestIdHeaders(id)` returns the header bag to
forward that ID on an outbound call (for example to a `narduk-data` fetch), and
`REQUEST_ID_HEADER` names the header once so no consumer has to repeat the
string or reach into `event.context._requestId`. The inbound header is validated
against a bounded charset, never trusted: any client can choose the ID its own
request arrives with, so it correlates requests and identifies nobody.

Every request now gets a `Server-Timing` response header — `total`-only by
default — stamped from Nitro's `beforeResponse` hook.
`useRequestTiming(event, options?)` (h3/Nitro) and the `timing` argument
`logRequest` now passes to its handler (`./worker`) return a `RequestTiming`
instance: `mark(name, description?)` closes the phase running since the previous
mark and starts the next one, and `measure(name, work)` wraps a callback the
same way. Named phases and their descriptions only reach the header once a route
opts in via `exposePhases` (or the plugin-level `timingExposePhases`), so a
public route never leaks internal phase names or whatever a caller put in a
description unless it explicitly decides that's fine. Descriptions are reduced
to printable ASCII and the rendered header is bounded to 32 phases and 2 KB. An
upstream `Server-Timing` is appended to, not replaced.

A response a shared cache may replay (`public`, `s-maxage`, `immutable`, unless
`private`/`no-store` overrides) carries neither `x-request-id` nor
`Server-Timing`: a cached per-request identity would be served to every later
client.

`RequestLoggingOptions.slowRouteThresholdMs` (h3/Nitro) and
`LogRequestOptions.slowRouteThresholdMs` (worker) are unset by default. Set one
to get a single structured `warn` "Slow route" log line for a request over
budget, carrying the route template, method, status, duration, and request ID —
never the raw URL, query string, or headers. It honours `skipPaths` and
`requestLogging: false`, so a silenced route stays silent; a 5xx stays visible.

Left out of this change: the `D1Probe` statement/round-trip counter contract
narduk-libs#325 also proposes. It is Cloudflare-D1-specific and needs its own
design pass; `RequestTiming.mark`'s optional `description` already lets an app
compute its own counts (statements, round trips, whatever it tracks) and pass
the formatted string straight through, without narduk-logging knowing anything
about D1. Refs #325.
