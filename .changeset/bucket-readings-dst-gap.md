---
'@narduk-enterprises/narduk-timeseries': patch
---

`bucketReadings` now ends a bucket at a spring-forward DST gap where the day
really changes (narduk-libs#938). A bucket edge that fell on a skipped wall time
(Chicago's 02:00, or midnight in America/Santiago) resolved backward onto the
previous edge. That gave zero-width buckets (`start === end`) and a bucket whose
`end` came before rows it held, overlapping the next one. Skipped wall times now
resolve forward to the transition instant, and a repeated fall-back hour still
opens on its first occurrence.
