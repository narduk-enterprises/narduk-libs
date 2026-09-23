---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The CSP report route answers 204 without reading any body that is not
`application/csp-report` or `application/reports+json`, and limits each client
to 60 reports a minute (rate-limit key `csp-report`); a request of any other
type is answered before the limiter and never counts against it (#444).
