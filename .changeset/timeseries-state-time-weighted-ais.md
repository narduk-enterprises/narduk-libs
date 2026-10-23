---
'@narduk-enterprises/narduk-timeseries': minor
---

Add four opt-in, additive capabilities for change-only telemetry (mybo-at-v2
docs/19 § 10 L3). Migration `0004` adds `telemetry_state`, a change-only
hypertable for strings, bools and JSON values, with `writeState`,
`queryStateAt` and `queryStateTransitions`. Migration `0005` adds
`telemetry_numeric_tw`, time-weighted rollups at 1m, 15m, 1h and 1d. The
library fills it with `refreshTimeWeighted` / `planTimeWeightedRefresh`,
reads it with `queryTimeWeightedRollup`, and `timeWeightedBuckets` gives the
same arithmetic in memory. Migration `0006` adds the AIS tables
`ais_contact`, `ais_encounter` and `ais_encounter_open`, and `0007` grants on
them. Retention gains a lossless mode: `globalRawWindowMs: 'never'` plans no
raw sweep. Existing reads, writes, rollups and retention plans are
unchanged. The new store methods live on the new `TelemetryStateStore` and
`TimeWeightedRollupStore` interfaces, so existing `TelemetryHistoryStore`
implementations still compile.
