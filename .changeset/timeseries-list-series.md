---
'@narduk-enterprises/narduk-timeseries': minor
---

Add `TelemetryHistoryStore.listSeries({ vesselId, paths?, maxRows? })`, the
read-only lookup of a vessel's series catalogue. Until now the only way to turn
a path into the `seriesId` that `queryRollup` takes was `resolveSeries`, the
write path's upsert: a reader using it created an empty series for every path it
asked about, and needed the writer's grants to do it. `listSeries` is one
`SELECT` that `history_reader` can run, binds three parameters whatever the path
count (the filter is one JSON text parameter, so a comma inside a SignalK path
stays one path and an unprepared Hyperdrive connection never sees a bare array),
orders by path, and reports `truncated` against a `maxRows` ceiling
(`DEFAULT_MAX_SERIES_ROWS`, 5_000; raise it with `maxSeriesRows` on the store).
A path the vessel never recorded is absent from the answer, never created. Minor
rather than patch because it adds a method to the interface: another
implementation of `TelemetryHistoryStore` must add it too.
