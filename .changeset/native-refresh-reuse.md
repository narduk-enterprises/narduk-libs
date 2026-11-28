---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth native sessions: a rotated refresh token works once. Presenting one
again, or the same token twice at once, ends its session for every holder, so a
stolen refresh token no longer keeps a parallel session alive
(narduk-libs#2179). Spent token hashes live in the new `auth_native_refreshes`
table: **an app with native clients applies `drizzle/0007_native_refresh_reuse.sql`
(or `drizzle-pg/0007`) before deploying this version**, or every native refresh
answers 500. Deleting a passkey now also ends the user's passkey-minted native
sessions (all of them: a session does not record which passkey minted it).
New `revokeUserGrant` on `createNativeAuth`. Apps without native clients change
nothing.
