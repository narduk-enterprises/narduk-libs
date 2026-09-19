---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

`createNardukDataClient` no longer re-downloads an unchanged release when its
TTL lapses. If the manifest still names the same release and artifact checksum,
the client keeps the cached value (and its object identity) and fetches only the
manifest.
