---
'@narduk-enterprises/narduk-timeseries': patch
---

Align `refreshRollupsStatements` by snapping the requested range outward onto
each level's bucket, then walking `maxWindowMs` steps so neighbours abut and no
CALL exceeds the ceiling. Fold a leftover narrower than one bucket into the
previous window. Reject an empty `buckets` list or a non-positive `maxWindowMs`
before the per-level loop (narduk-libs#293).
