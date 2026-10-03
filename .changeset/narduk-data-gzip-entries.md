---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-data client: `product.encoding: 'gzip'` reads a release file published
as a gzip of its JSON (riverstatus#387). The manifest SHA-256 is checked
against the compressed bytes, which are stored as published; they are then
decompressed under `product.maxDecodedBytes` (default 16 MiB, cancelled
mid-stream at the ceiling) and parsed as before. Encoding and the decoded
ceiling are part of the cache key. Reads without `encoding` are unchanged.
create-narduk-app: pin the new narduk-core.
