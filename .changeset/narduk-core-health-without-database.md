---
'@narduk-enterprises/narduk-core': minor
---

Let apps run without a database and extend `/api/health` with their own checks.

- Add the `databaseBackend` module option: `'d1'`, `'postgres'` or `'none'`. It
  takes precedence over `NUXT_DATABASE_BACKEND`; an app that sets neither keeps
  the D1 default. With `'none'`, `/api/health` reports
  `database: "not_applicable"`, `useDatabase` throws an HTTP 500 that names the
  declaration, and a bearer API key authenticates nobody.
- Add `registerHealthCheck` for named required or optional checks. The health
  response gains a `checks` array listing the built-in `database` and
  `auth-tables` probes and every registered check. Existing fields keep their
  names and values.
- Probe D1 apps without narduk-auth with `SELECT 1`. They previously ran the
  auth-table lookup and reported `schema_error`.
- Send `Cache-Control: no-store` on `/api/health`.

**Behavior change: `/api/health` answers HTTP 503 when `status` is `error`.** It
previously answered 200 for every status. `degraded` still answers 200. A
monitor or deploy check that treats any 200 as healthy now sees failures, and
one that parses the body of a non-2xx response must accept a 503 with the same
JSON body.

**Behavior change: a declared D1 database without its `DB` binding is `error`
(503).** It was `degraded`. This applies when the app sets `databaseBackend` by
module option, `NUXT_DATABASE_BACKEND` or `runtimeConfig`; an app that declares
nothing keeps `degraded`.

**Build failure: `databaseBackend: 'none'` with
`@narduk-enterprises/narduk-auth` fails the build** with a message naming the
conflict, because narduk-auth stores users, sessions and API keys in the app
database.
