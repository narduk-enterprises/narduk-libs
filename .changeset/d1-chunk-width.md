---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

D1 chunking now counts bound parameters, not values. `chunkD1BoundValues`,
`runD1Chunked` and `collectD1ChunkedRows` accept `parametersPerValue`, for
composite keys and row width, and `reservedParameters`, for binds outside the
list. The new `chunkD1Rows(rows, table | columnCount)` sizes multi-row
`INSERT`s from the Drizzle table's column count.

An explicit `chunkSize` above the budget throws at call time. With no width
options, the defaults are unchanged.
