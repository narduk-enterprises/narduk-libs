---
'@narduk-enterprises/narduk-core': patch
---

Omit `upgrade-insecure-requests` from the `security.headers` report-only CSP.
Browsers ignore that directive in a report-only policy and Chromium logs a
console error on every page. The enforcing header still includes it.
