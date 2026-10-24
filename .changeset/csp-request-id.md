---
'@narduk-enterprises/narduk-app': minor
'@narduk-enterprises/narduk-logging': minor
---

`buildSecurityHeaders` takes an optional enforced `csp` (a
`Content-Security-Policy` header) beside `reportOnlyCsp`; absent, nothing
changes. New `@narduk-enterprises/narduk-app/server/request-id`
(`resolveRequestId`, `stampRequestId`, `applyRequestId`, `installRequestId`) and
`/server/request-id-error-handler` (a Nitro `errorHandler` that adds a top-level
`requestId` to `/api/` error bodies). `installServerErrorCapture` now reads
`event.context.requestId` before `cf-ray` / `x-request-id`. Closes
narduk-libs#2031.
