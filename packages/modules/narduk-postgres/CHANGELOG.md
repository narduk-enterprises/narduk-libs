# Changelog

## 0.1.0

- Initial release: one Postgres access surface for the self-hosted backend.
- Workers connections over a Hyperdrive binding, with the connection lifetime
  bound to the invocation, a capped `max`, and a statement timeout always set.
- Direct Node connections, plus migration loading from a directory.
- Health check: `SELECT 1` and extension presence, in two statements, never
  throwing, always redacted.
- Migrations runner: ordered SQL files, a `schema_migrations` table, checksum
  immutability, an advisory lock, a dry run, and a `-- narduk:no-transaction`
  directive.
- Typed helpers for the `ingest_writer` / `history_reader` / `ops` roles, with
  `SET ROLE` never taken from user input.
- Parameter budgets against the 65535 Bind ceiling, and a protocol fake for
  tests.
