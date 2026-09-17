---
'@narduk-enterprises/narduk-core': patch
---

Exempt the configured CSP report route from CSRF so browser `report-uri` POSTs
can reach the sink.

`security.headers` registers `POST` at `reportRoute` (default
`/api/_security/csp-report`) and emits that path as `report-uri`. Browsers send
`application/csp-report` with no `X-Requested-With`, so the estate CSRF
middleware was returning 403 and a report-only soak looked empty. The skip now
reads `runtimeConfig.nardukSecurityHeaders.reportRoute` — the same value the
module writes when it registers the handler — rather than a hardcoded path. The
skip applies only when `nardukSecurityHeaders.mode` is `report-only` or
`enforce`, so the default `off` mode does not CSRF-exempt a 404.
