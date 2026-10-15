---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`deployment.liveProof.smokeContentType` (optional) names the content type the
smoke path answers with. `ship` and `deploy staging` pass it to `verify --live`
as `--expect-content-type`, so a JSON smoke route such as
`/api/auth/runtime-public` proves instead of failing the `text/html` default.
