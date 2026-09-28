---
'@narduk-enterprises/narduk-devices': patch
---

`revokeClaimToken` and `pruneExpired` now send their writes as one atomic batch: a failure part-way applies none of them instead of leaving a revoked token with a still-pending claim session, or a partial prune.
