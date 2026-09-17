---
'@narduk-enterprises/narduk-logging': patch
---

Emit the `Request completed` summary on failing requests, not only successful
ones.

`installNitroLogging` completed every request from the `afterResponse` hook and
had the `error` hook defer to it. That boundary is unreachable on a failing
request: h3's app sends the error response from its own `onError` handler, sees
`event.handled`, and returns without calling `onAfterResponse` — in both the
Node listener and the fetch handler the Cloudflare Worker artifact is built
from. A handled 5xx and an unhandled 500 therefore produced no summary at all,
and an unrouted path produced no record of any kind, because the deferral was
also gated on `status >= 500`.

The `error` hook now completes the record itself, using the status the error
handler is about to send; the existing once-per-request flag keeps a runtime
that does reach `afterResponse` from emitting a second one. Every request now
produces exactly one summary with `status`, `durationMs` and `requestId` on
success, on a handled error and on an unhandled error, in both runtimes.

The record shape is unchanged, so this is a patch. A 5xx summary still carries
the canonical `error` object; a 4xx summary still omits it, because the
framework's own 4xx message quotes the raw request target that the route
template deliberately keeps out of records. `requestLogging: false`, `skipPaths`
(which still never suppress a 5xx), redaction and level handling are untouched.
