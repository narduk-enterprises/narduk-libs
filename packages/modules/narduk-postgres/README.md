# @narduk-enterprises/narduk-postgres

One Postgres access surface for Narduk apps: a Workers connection over a
Hyperdrive binding, a direct Node connection for migrations and jobs, a health
check, a migrations runner, and typed least-privilege role helpers.

It ships **no driver**. The package builds connection options, statements and
plans; the app passes in whatever client it already bundles (`postgres`,
`node-postgres`, or a test fake) as an object with a single
`query(text, params)` method. That keeps a Worker bundle carrying exactly one
driver, and makes every code path in this package testable without a database.

## Install

```bash
pnpm add @narduk-enterprises/narduk-postgres
```

## Exports

| Subpath     | What it holds                                                       |
| ----------- | ------------------------------------------------------------------- |
| `.`         | Errors, redaction, types, tuning, parameter budgets, roles, health  |
| `./worker`  | The Hyperdrive connection path (no `node:` imports)                 |
| `./node`    | Direct Node connections and migration loading from a directory      |
| `./migrate` | The migrations runner (`schema_migrations`, advisory lock, dry run) |
| `./testing` | `ProtocolFake`, a wire-rule-enforcing executor for unit tests       |

`.`, `./worker`, `./migrate` and `./testing` import nothing from `node:`, so all
four are importable inside a Worker bundle. `./node` is the only module that
touches the filesystem.

## Workers connection rules

```ts
import { withHyperdriveConnection } from '@narduk-enterprises/narduk-postgres/worker'
import postgres from 'postgres'

export default {
  async fetch(request: Request, env: Env) {
    return withHyperdriveConnection(
      {
        binding: env.HISTORY_DB,
        connect: (connectionString, options) => {
          const sql = postgres(connectionString, options)
          return {
            end: () => sql.end(),
            async query<Row = Record<string, unknown>>(
              text: string,
              params?: readonly unknown[],
            ) {
              const rows = await sql.unsafe(text, params as never[])
              return {
                rowCount: rows.count ?? rows.length,
                rows: [...rows] as unknown as Row[],
              }
            },
          }
        },
      },
      async (connection) => {
        // one invocation, one connection
      },
    )
  },
}
```

Spread `rows` into a plain array so `SqlExecutor` does not leak the driver's
`RowList`.

Four rules the helpers enforce rather than document:

- **The connection lifetime is the invocation.** `withHyperdriveConnection`
  closes the connection in a `finally`, and a close failure never masks the
  error from the body.
- **No pool outlives the invocation.** `max` is capped at
  `WORKER_CONNECTION_CEILING` (6) and defaults to 5. Hyperdrive owns the real
  pooling; a Worker-side pool that survives the request is a connection leak
  with a different name.
- **A statement timeout is always set**, through startup parameters, so a
  runaway query cannot hold a Hyperdrive connection for the whole invocation
  budget. Workers default to 15 s; Node defaults to 5 min because migrations and
  retention sweeps legitimately take longer.
- **Prepared statements and type introspection are off** for the Workers driver
  options (`prepare: false`, `fetch_types: false`): both assume a session the
  pooler does not guarantee.

`env.HISTORY_DB.connectionString` never appears in an error message. Everything
this package throws passes through `redactSecrets()`, which replaces the
password in a DSN and any `password=`/`token=` pair with `***`.

## Migrations

```ts
import { loadMigrationsFromDirectory } from '@narduk-enterprises/narduk-postgres/node'
import {
  applyMigrations,
  planMigrations,
} from '@narduk-enterprises/narduk-postgres/migrate'

const migrations = await loadMigrationsFromDirectory(
  new URL('./migrations/', import.meta.url),
)
const plan = await planMigrations(connection, migrations) // read-only
const result = await applyMigrations(connection, migrations, { dryRun: true })
```

- Files are named `NNNN_snake_case.sql` and applied in lexical order.
- Each applied file's **sha256 is recorded**. Editing an applied file fails with
  `MIGRATION_MODIFIED` rather than silently diverging environments — the same
  rule mybo-at-v2 enforces on D1 after a migration was edited in place
  (mybo-at-v2#81).
- A missing applied file fails with `MIGRATION_MISSING`; a new file that sorts
  _before_ an applied one fails with `MIGRATION_OUT_OF_ORDER`.
- A `pg_try_advisory_lock` serialises concurrent deploys. That lock is
  **session-scoped**, so the executor must be a **single connection, not a
  pool** — `migrationDriverOptions()` pins `max: 1` for exactly this reason.
- A file whose **first line** is `-- narduk:no-transaction` runs outside a
  transaction, for DDL Postgres or Timescale refuses to run inside one. Such a
  file is split into top-level statements (quote-, comment- and dollar-quote-
  aware) and sent **one statement per round trip**: a multi-statement simple
  query is itself an implicit transaction, so sending the file whole would
  reject exactly the DDL the directive exists for.
- Files without that directive now run in a real `BEGIN`/`COMMIT` on a plain
  `SqlExecutor` (the package's own connections have no `.transaction`). If a
  default-transactional file contains `CREATE`/`DROP INDEX CONCURRENTLY`,
  `REINDEX … CONCURRENTLY`, `VACUUM`, `CREATE`/`DROP DATABASE`, `ALTER SYSTEM`,
  `CREATE`/`DROP TABLESPACE`, or a TimescaleDB continuous aggregate created with
  data (`CREATE MATERIALIZED VIEW … WITH (timescaledb.continuous)` without
  `WITH NO DATA`), `applyMigrations` fails **before running the file** with
  `MIGRATION_TRANSACTION_FORBIDDEN` and names the directive. It does not
  silently opt the file out. Put `-- narduk:no-transaction` on line 1 for those
  statements. `ALTER TYPE … ADD VALUE` is allowed: Postgres 12 and later run it
  inside a transaction.
- `applyMigrations(connection, migrations, { table })` puts a set in its own
  ledger table (default `schema_migrations`), so two independent migration sets
  can share a database without either seeing the other's history. The table name
  is validated against `/^[a-z_][a-z0-9_]*$/`.
- The advisory unlock is checked: `pg_advisory_unlock` returning false raises
  `MIGRATION_UNLOCK_FAILED`, and it can never mask a migration failure that
  happened first.

## Roles

Three least-privilege roles, named once:

```ts
import {
  assertPostgresRole,
  roleGrantStatements,
  setRoleStatement,
} from '@narduk-enterprises/narduk-postgres'

setRoleStatement(assertPostgresRole(configuredRole)) // 'ingest_writer' | 'history_reader' | 'ops'
```

`setRoleStatement` accepts only a member of the frozen role tuple, so a role can
never be interpolated from user input. Identifiers in generated DDL are
validated against `/^[a-z_][a-z0-9_]*$/` and quoted.

**Creating roles is not this package's job, and neither is setting their
timeouts.** The deployment's own provisioning creates the three roles and sets
each one's role-level `statement_timeout` (narduk-infrastructure#155); both need
superuser, and a library that re-issued them would either fail for lack of
privilege or quietly override the deployment's deadline with its own. What this
module owns is `roleGrantStatements`, the GRANT matrix — which is what generates
narduk-timeseries' `0003_history_roles.sql`, asserted there by a test so the two
cannot drift. This package never handles a credential.

## Parameter budgets

The v3 wire protocol's Bind message carries a **16-bit** parameter count, so
`POSTGRES_MAX_BIND_PARAMETERS` is 65535 — a hard protocol ceiling, not a
tunable. `DEFAULT_PARAMETER_BUDGET` is 32768: half the ceiling, leaving room for
a caller that adds columns without re-deriving its batch size.

```ts
import {
  chunkRowsByParameterBudget,
  maxRowsPerStatement,
} from '@narduk-enterprises/narduk-postgres'

const chunks = chunkRowsByParameterBudget(rows, 6) // 6 parameters per row
```

A batch builder that ignores this is the mybo-at-v2#83 failure: a 500-parameter
upsert against a 100-parameter ceiling failed every batch in production.

## The protocol fake

`./testing` exports `createProtocolFake()`, an executor that enforces what the
wire enforces — the 65535 ceiling, placeholders dense from `$1`, the parameter
count matching the highest `$n`, encodable values — and records every statement
so a test can assert statement and parameter counts.

Use `createProtocolFake({ unpreparedTextParameters: true })` for postgres.js
`prepare: false` consumers. This mode rejects bare JavaScript array binds, which
that driver path sends as comma-joined text rather than a PostgreSQL array
literal. Generic mode remains available for drivers with array encoding.

`checkHealth` binds each extension name separately. After `SELECT 1` succeeds, a
later statement error preserves `connected: true` while returning `ok: false`
and the redacted error; extension availability is unproven on that error path.

### Real-driver health proof

Set `NARDUK_POSTGRES_LIVE_DSN` through a secret-injecting process to a database
with TimescaleDB and PostGIS, then run `pnpm run test:live` in this package. It
fails if the DSN is absent. The normal unit run skips this explicitly named live
suite when no DSN is supplied. The suite uses postgres.js 3.4.9 with the
Worker's `prepare: false`, `fetch_types: false`, one socket, and bounded
timeouts. It reproduces the old `22P02`, proves extension presence and absence,
and checks that a real later statement error retains successful connectivity.
Every query is read-only; it runs no migration and creates no fixture data.

For the documented loopback SSH tunnel to a private Origin CA certificate only,
set `NARDUK_POSTGRES_LIVE_SSH_TUNNEL=1` to encrypt without certificate
validation. Direct connections retain the driver's default TLS verification.

**What it does not emulate:** SQL semantics, the type system, the planner,
transaction isolation, constraint enforcement, or extension behaviour. A green
run against the fake proves a builder's shape, never its meaning. That is what
the live suites are for.

## Backends

Both backends hand out the same `SqlExecutor`, through the consumer's own
driver, so health, migrations, roles and the timeseries builders do not change
with the backend. What differs is the capability matrix:

| Backend / mode                                               | `ddl` | `roleSwitching` | `timescale` |
| ------------------------------------------------------------ | ----- | --------------- | ----------- |
| self-hosted (`SELF_HOSTED_CAPABILITIES`)                     | yes   | yes             | yes         |
| Supabase `direct` (`db.<ref>.supabase.co:5432`)              | yes   | yes             | no          |
| Supabase `session` (`*.pooler.supabase.com:5432`)            | yes   | yes             | no          |
| Supabase `transaction` (port `6543`, Supavisor or PgBouncer) | no    | no              | no          |

### Supabase (`createSupabaseBackend`)

narduk-libs#112's Supabase half. No `@supabase/supabase-js`, PostgREST or auth:
Supabase is PostgreSQL, reached with the same driver as every other path.

```ts
import postgres from 'postgres'
import { createSupabaseBackend } from '@narduk-enterprises/narduk-postgres'

const backend = createSupabaseBackend({
  connectionString: env.SUPABASE_DB_URL,
  connect: (dsn, options) => {
    const sql = postgres(dsn, options)
    return {
      query: async (text, params = []) => {
        const rows = await sql.unsafe(text, params as never[])
        return { rows, rowCount: rows.count }
      },
      end: () => sql.end(),
    }
  },
})

await backend.withConnection((db) => checkHealth(db))
```

- The mode is read from the host and port Supabase publishes; a custom domain or
  a self-hosted Supabase states `mode`. A stated mode that contradicts the host
  is refused.
- TLS is required: `sslmode=disable|allow|prefer` is refused, and the driver
  options always carry `ssl` (default `require`; pass `verify-full` with the
  Supabase CA configured in the driver).
- Transaction mode (port 6543) cannot keep session state, so its capabilities
  say no DDL (the migration runner's advisory lock is session-scoped: migrate
  over a direct or session connection) and no role switching; a `tuning.role`
  there is refused before any socket opens.
- `timescale` is false in every mode: Supabase deprecated TimescaleDB on
  Postgres 17 projects.
- `runtime: 'worker'` applies the Worker tuning defaults and six-socket ceiling;
  the default is the Node tuning. Each `withConnection` opens one connection and
  closes it afterwards, as the Worker and Node paths do.
- Failures are `NardukPostgresError` with code `SUPABASE_CONNECTION_INVALID` (or
  `CONNECTION_STRING_MISSING`), with the connection string redacted.

`SUPABASE_BACKEND_STATUS` is deprecated and kept only so existing imports
compile.

## Licence

UNLICENSED — internal to Narduk Enterprises.
