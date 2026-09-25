---
'@narduk-enterprises/narduk-devices': minor
---

`listAuditEvents` accepts `beforeId` alongside `before`, making a
`(createdAt, id)` cursor that matches the list's sort order. One claim writes
several audit rows with the same `createdAt`, and a page boundary inside that
group used to skip the rest of it (narduk-libs#974, the same gap as
narduk-tenancy's #941). To page, pass the last row's `createdAt` and `id`.
`before` alone keeps its old meaning.
