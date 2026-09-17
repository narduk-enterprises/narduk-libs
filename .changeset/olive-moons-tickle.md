---
'@narduk-enterprises/narduk-testkit': patch
---

Block optional-telemetry requests in `createConsoleTracker`'s
`telemetry: 'stub'` profile instead of answering them with an empty `204`.
Cloudflare injects its RUM beacon with an `integrity` attribute, so the empty
body 1.3.1 supplied failed Subresource Integrity, and Chromium reports that
failure against the document rather than the beacon — an error no origin-scoped
filter can attribute to telemetry. Measured against a real deployment, the `204`
traded three `ERR_CONNECTION_REFUSED` errors for six unattributable SRI errors.
An aborted request is never integrity-checked and its `ERR_BLOCKED_BY_CLIENT`
console entry carries the telemetry URL, so the origin filter catches it.
