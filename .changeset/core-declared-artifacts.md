---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

`createNardukDataClient` can now read declared sub-artifacts. The new
`product.declaredArtifactPath` option reads an artifact the release manifest
lists in `artifacts[]`, such as a nested `states/tx.json` shard. The bytes are
checked against that entry's own SHA-256. An undeclared or unsafe path is
refused before any artifact request, and each path is its own bounded cache
entry (narduk-libs#551). `create-narduk-app` gets a companion patch so the
generator pin moves with the core minor.
