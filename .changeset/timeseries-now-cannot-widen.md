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

## Operator action

The ceiling **is** the default, so there is no headroom above it: a caller that
previously passed `maxRows` or `maxPoints` above `50_000` / `5_000` was accepted
and is now rejected with `RANGE_INVALID`. Raise
`TimescaleStoreOptions.maxRollupRows` / `maxTrackPoints` on the server-side
store if you need the larger working set.

A test or handler that passed a **past** `RollupQuery.now` as a deterministic
clock no longer widens the window — the tier floor is computed from the real
clock. Freeze time instead (`vi.setSystemTime`); in-repo `store.test.ts` shows
the pattern.
