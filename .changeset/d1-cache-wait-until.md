---
'@narduk-enterprises/narduk-core': patch
'create-narduk-app': patch
---

`withD1Cache` now hands its stale-window background refresh to the request's
`waitUntil`, trying `event.waitUntil`, then the Cloudflare `ExecutionContext`,
then `event.context.waitUntil`. Before, a Worker could cancel the refresh once
the response was sent, so the row stayed stale and every request in the window
started another refresh that could also be dropped. `_meta.cachedAt` now
reports when the served value was written (`expires_at` minus `ttlSeconds`)
instead of the time of the current request.
