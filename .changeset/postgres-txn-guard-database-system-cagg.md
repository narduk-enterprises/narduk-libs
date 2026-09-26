---
'@narduk-enterprises/narduk-postgres': patch
---

`applyMigrations` now refuses `CREATE DATABASE`, `DROP DATABASE`, `ALTER SYSTEM`, `CREATE TABLESPACE`, `DROP TABLESPACE` and a TimescaleDB continuous aggregate created with data (`CREATE MATERIALIZED VIEW … WITH (timescaledb.continuous)` without `WITH NO DATA`) in a default-transactional file, before `BEGIN`, with `MIGRATION_TRANSACTION_FORBIDDEN` naming the `-- narduk:no-transaction` directive. Before, these reached Postgres and failed with its raw "cannot run inside a transaction block" error. A file that already carries the directive is unaffected (#1039).
