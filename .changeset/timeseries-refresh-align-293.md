---
'@narduk-enterprises/narduk-timeseries': patch
---

Align `refreshRollupsStatements` windows to each level's bucket, fold a
sub-bucket remainder into the previous window, and reject an empty `buckets`
list or a non-positive `maxWindowMs` before the per-level loop (narduk-libs#293).
