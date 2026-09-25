---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Account deletion now re-authenticates Supabase email+password users against
Supabase. `POST /api/auth/account/delete` only checked the local
`users.password_hash`, which Supabase-provisioned users never have, so on the
Supabase backend a request with `{}` deleted the local user and the upstream
identity with no password. A linked user with a stale local hash had the
opposite problem: deletion demanded the old local password. On a Supabase
session the route now verifies `currentPassword` with `signInWithPassword`, the
same check password change uses, and never consults the local hash
(narduk-libs#923).

`deleteCurrentUserAccountBridge` (and its `deleteCurrentUserAccount` alias)
accepts a new optional `verifyCredentials` hook that replaces the local hash
check; the new `verifySupabaseAccountDeletionCredentials` export is the Supabase
one. Provider-only accounts and the local backend behave as before.
