---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-data client: with `trustValidatedStoreHits` on, a store hit that names this build's mark is no
longer hashed again on read (riverstatus#669). The entry's key already carries the manifest SHA-256 and
the client wrote the mark only after the bytes matched it, so the mark now vouches for the bytes as well
as the schema walk. Every other path keeps the digest and the delete-on-mismatch: an unmarked entry, an
entry another build marked, and any read with the option off. A marked entry whose bytes no longer
decode (corrupt or truncated) is deleted and read from upstream rather than failing every isolate
until it expires. On a 2.9 MB artifact the cold-isolate store-hit read drops by about one SHA-256 pass.
