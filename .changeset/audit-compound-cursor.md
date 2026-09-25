---
'@narduk-enterprises/narduk-tenancy': minor
---

`listAuditEvents` accepts `beforeId` alongside `before`, making a
`(createdAt, id)` cursor that matches the list's sort order. One
`acceptInvite` writes two or three audit rows with the same `createdAt`, and a
page boundary inside that group used to skip the rest of it. To page, pass the
last row's `createdAt` and `id`. `before` alone keeps its old meaning.
