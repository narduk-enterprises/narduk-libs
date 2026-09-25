---
'@narduk-enterprises/narduk-timeseries': patch
---

A decimated `queryTrack` now anchors its buckets on `range.start`
(narduk-libs#939). `time_bucket` aligned them to TimescaleDB's 2000-01-03
origin, so a fully covered range almost always touched `maxPoints + 1` buckets,
with a partial one at each end. `queryTrack` read the extra row as truncation,
reported `truncated: true`, and sliced off the newest bucket, which holds the
vessel's latest position. It now gets at most `maxPoints` buckets, and
`truncated` means a real cap.
