---
'@narduk-enterprises/narduk-core': patch
---

`authenticateApiKey` reads the key and its user in one joined statement instead
of two sequential ones (narduk-libs#1396), so a request that authenticates with
an API key pays one D1 round trip for verification, not two. Authentication
answers are unchanged: an unknown key, a revoked key, an expired key and a key
whose user row is missing each still return `null` (`requireAuth` still answers
401), a live key still returns the full key and user rows, and `last_used_at`
is still touched fire-and-forget on success. No new path authenticates, and no
export or signature changes.
