---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

A key minted by another API key can no longer outlive it (narduk-libs#920). `POST /api/auth/api-keys` from an API-key caller clamps a child with no `expiresInDays` to the calling key's expiry, and refuses with 403 an explicit expiry past it, or `null` under a key that expires. A `*` key can no longer renew itself for another 90 days before it expires. Session callers are unchanged. narduk-core's `AuthUser` gains an optional `apiKey: { id, expiresAt }` naming the key behind an `api-key` principal.
