# Changelog

## 0.1.0

- Initial release: one Postgres access surface for the self-hosted backend.
- Workers connections over a Hyperdrive binding, with the connection lifetime
  bound to the invocation, a capped `max`, and a statement timeout always set.
- Direct Node connections, plus migration loading from a directory.
- Health check: `SELECT 1` and extension presence, in two statements, never
  throwing, always redacted.
- Migrations runner: ordered SQL files, a configurable ledger table
  (`schema_migrations` by default), checksum immutability, an advisory lock
  whose unlock result is checked and which never masks a migration failure, a
  dry run, and a `-- narduk:no-transaction` first-line directive — a
  non-transactional file is split into top-level statements and sent one per
  round trip, since a multi-statement simple query is an implicit transaction.
  The splitter honours dollar tags containing digits (`$func1$`) and backslash
  escapes inside an E-string (`E'it\'s'`) — and only inside one, since a
  backslash in a standard literal is an ordinary character.
- Typed helpers for the `ingest_writer` / `history_reader` / `ops` roles, with
  `SET ROLE` never taken from user input, and the GRANT matrix that generates
  narduk-timeseries' role migration. The matrix separates `update` from
  `mutate`, so a role that upserts a dimension row can be granted UPDATE on that
  one table without also being granted DELETE. Creating roles and setting their
  `statement_timeout` belongs to the deployment (narduk-infrastructure#155).
- Parameter budgets against the 65535 Bind ceiling, and a protocol fake for
  tests.
