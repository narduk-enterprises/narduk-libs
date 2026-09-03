---
'@narduk-enterprises/create-narduk-app': patch
---

create-narduk-app: stop scaffolding a health-check stub that shadows
narduk-core's real one.

Every generated app includes `@narduk-enterprises/narduk-core` as an implicit
module (`moduleList()`), which registers a real DB-probing `/api/health` route
via `addServerScanDir`. The generator also wrote an app-local
`apps/web/server/api/health.get.ts` returning a trivial `{ ok: true }` stub —
Nitro resolves an app-local `server/api/*` route before a module's scanned
contribution with the same path, so every scaffolded app silently lost the real
auth-table/D1/Postgres health check behind a stub that always says OK
(company-hq#453 R4 audit finding). The generator no longer emits that file;
narduk-core's own health route is now what a generated app actually serves.
Patch: removes generated output only, no exported API changed.
