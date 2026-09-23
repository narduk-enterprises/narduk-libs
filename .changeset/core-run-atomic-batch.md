---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

`runAtomicBatch(db, statements)` runs a group of writes as one transaction on D1
(`batch()`) or better-sqlite3 (`$client.transaction`), so apps stop copying
tenancy's dual-driver helper (#201).
