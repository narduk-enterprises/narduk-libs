---
'@narduk-enterprises/create-narduk-app': patch
---

Pin generated apps to `@narduk-enterprises/narduk-core` 2.6.3, whose report-only
security-headers preset no longer emits `upgrade-insecure-requests` — a
directive browsers ignore in a report-only policy and Chromium logs a console
error for on every document load.
