---
'@narduk-enterprises/narduk-timeseries': patch
---

Stop a client-supplied `now` from widening rollup reads or deepening retention
deletes.

`RollupQuery.now` may only raise the tier floor (`max(real now, now)`).
`RetentionPolicyInput.now` may only move delete cutoffs earlier
(`min(real now, now)`). Exported signatures are unchanged.

Client-supplied `maxRows` / `maxPoints` are hard-capped at the published
defaults (50_000 / 5_000). Values above the ceiling, including `1e12`, throw
`RANGE_INVALID`. Raise the ceiling only via
`TimescaleStoreOptions.maxRollupRows` / `maxTrackPoints` on the server-side
store.
