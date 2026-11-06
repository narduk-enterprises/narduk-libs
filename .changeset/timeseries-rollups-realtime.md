---
'@narduk-enterprises/narduk-timeseries': minor
---

Rollup reads reach the present (mybo-at-v2#533). New migration
`0009_rollups_realtime.sql` turns on real-time aggregation
(`timescaledb.materialized_only = false`) for `telemetry_numeric_15m`, `_1h` and
`_1d`, so a read includes the not-yet-materialized tail computed from the level
below, and tightens the 1h policy to `end_offset` 15 minutes on a 15-minute
schedule and the 1d policy to `end_offset` 1 hour. Before it, a 1h bucket became
readable two to three hours after it opened and a 1d bucket about two days
after. Nothing is dropped: no materialized bucket or grant is lost, and every
step is reversible. The newest 15m/1h/1d bucket is now partial until it closes.
