---
'@narduk-enterprises/narduk-testkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `@narduk-enterprises/narduk-testkit/e2e/readiness`: `registerReadinessSetup`
is the body of the preset's `setup` project (base URL → `/api/health` status
`ok|degraded` plus optional app assertions → warm each listed route once), so
apps stop repeating per-spec `beforeAll` readiness guards (#1000).
