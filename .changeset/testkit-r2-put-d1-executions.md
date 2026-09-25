---
'@narduk-enterprises/narduk-testkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

`createFakeR2Bucket().put()` no longer ignores what a real bucket enforces (#916). It honours the `R2Conditional` form of `onlyIf`: it resolves `null` and writes nothing when the condition fails, so create-if-absent via `etagDoesNotMatch: '*'` works. It throws on the `onlyIf` forms it does not emulate (a `Headers` object, a weak `W/` etag). It rejects an `md5`/`sha*` checksum that does not match the body, and parses a `Headers` passed as `httpMetadata`. `writeHttpMetadata()` writes all six stored fields, not only content-type and cache-control.

The `narduk-testkit/d1` harness records statements when they execute, not when they are prepared (#922). A per-item loop over one reused prepared statement, which is the shape of every drizzle `.prepare()`d query, now counts once per item, so `expectStatementBudget` and `scaleMatrix` catch that N+1. Each `batch()` member counts as one statement, and a statement prepared but never run no longer counts.
