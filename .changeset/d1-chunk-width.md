---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: D1 bound-parameter chunking counts parameters, not values
(narduk-libs#988). `chunkD1BoundValues`, `runD1Chunked` and
`collectD1ChunkedRows` take `parametersPerValue` and `reservedParameters`,
derive the chunk size from them, and throw at call time when an explicit
`chunkSize` would overrun. New `chunkD1Rows(rows, table)` sizes multi-row
`INSERT` chunks from the table's column count. With no new option set, behaviour
is unchanged.
