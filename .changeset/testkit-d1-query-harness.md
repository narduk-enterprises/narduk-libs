---
'@narduk-enterprises/narduk-testkit': minor
---

New `./d1` export: a Miniflare D1 query harness for Vitest.
`createD1QueryHarness({ migrations })` applies a migration list or directory and
returns `{ db, raw, statements, reset(), clearData(), dispose() }` with every
statement prepared on `db` recorded. `expectStatementBudget` fails above a
statement ceiling, `expectQueryPlan` fails on `SCAN <table>` in
`EXPLAIN QUERY PLAN`, and `scaleMatrix` runs a history × live matrix, fails
unless the statement count is constant, and returns per-cell statements, bytes
and results. It proves query shape, not latency. `miniflare` is a new optional
peer dependency, loaded only when a harness is created.
