---
'@narduk-enterprises/narduk-auth': minor
---

Drop the published Postgres bridge surface:
`server/database/auth-bridge-pg-schema`, `server/database/pg-app-schema`, and
`server/database/pg-schema` are removed, along with the `typecheck:postgres`
gate in `quality:strict`. The package advertised a Postgres dialect it never
shipped migrations for (narduk-libs#94) — `useAuthBridgeDatabase` now calls
`createAppDatabase` with the D1 schema only, so a Postgres-backend build no
longer gets a type-checked-but-non-functional auth bridge; it gets a clear
absence instead.

Per operator decision:

> Logan, 2026-09-04: "Drop the published Postgres surface (Recommended)"

**Migration for a consumer importing the removed subpath:** if your app imports
`@narduk-enterprises/narduk-auth/server/database/auth-bridge-pg-schema`
(directly or via your own `server/database/pg-app-schema.ts` re-export), delete
that import — it was unused scaffolding with no matching migration on either
side. One known consumer is tracked at narduk-enterprises/been-sober-for#95.
