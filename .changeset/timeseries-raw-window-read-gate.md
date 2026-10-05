---
'@narduk-enterprises/narduk-timeseries': minor
'@narduk-enterprises/create-narduk-app': patch
---

`applyRetention` no longer deletes raw rows per tier. That row delete invalidated
the continuous aggregates, and their next refresh emptied the tier's 1m rollups
inside the refresh window (narduk-libs#1081, reproduced on TimescaleDB 2.30.1).
A tier's `rawWindowMs` is now a read depth: raw is kept for `globalRawWindowMs`
for every vessel, and a consumer reading raw for a tier clips the range start to
`now - rawWindowMs`. Consumers that relied on the sweep to hide older raw from a
tier must clip their raw reads.
