---
'@narduk-enterprises/narduk-timeseries': patch
---

Stop a client-supplied `now` from widening rollup reads or deepening retention
deletes.

`RollupQuery.now` may only raise the tier floor (`max(real now, now)`).
`RetentionPolicyInput.now` may only move delete cutoffs earlier
(`min(real now, now)`). Exported signatures are unchanged.
