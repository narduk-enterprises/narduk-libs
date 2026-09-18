---
'@narduk-enterprises/narduk-core': minor
---

`useDatabase(event)` and `createAppDatabase` accessors now count D1 round trips
on narduk-logging's request counter (narduk-libs#511): one per `first` / `all` /
`run` / `raw` on a prepared statement, and one carrying every statement for a
`batch`. The counts reach `Server-Timing` and the "Request completed" record.
Counting never fails a query.
