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
            query: async (text, params) => {
              const rows = await sql.unsafe(text, params as never[])
              return { rowCount: rows.count ?? rows.length, rows }
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
- A file whose first line is `-- narduk:no-transaction` runs outside a
  transaction, for DDL Postgres or Timescale refuses to run inside one.

## Roles

Three least-privilege roles, named once:

```ts
import {
  assertPostgresRole,
  setRoleStatement,
  createRoleStatement,
} from '@narduk-enterprises/narduk-postgres'

setRoleStatement(assertPostgresRole(configuredRole)) // 'ingest_writer' | 'history_reader' | 'ops'
```

`setRoleStatement` accepts only a member of the frozen role tuple, so a role can
never be interpolated from user input. Identifiers in generated DDL are
validated against `/^[a-z_][a-z0-9_]*$/` and quoted; a `statement_timeout` must
match `/^\d+(?:ms|s|min)$/`. The roles are created `NOLOGIN`: this package never
handles a credential, and an operator grants a login role membership out of
band.

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

**What it does not emulate:** SQL semantics, the type system, the planner,
transaction isolation, constraint enforcement, or extension behaviour. A green
run against the fake proves a builder's shape, never its meaning. That is what
the live suites are for.

## Backends

`SELF_HOSTED_CAPABILITIES` describes the self-hosted backend this package
implements. The Supabase backend of narduk-libs#112 is an interface seam with a
single `TODO(#112)` marker and no implementation.

## Licence

UNLICENSED — internal to Narduk Enterprises.
