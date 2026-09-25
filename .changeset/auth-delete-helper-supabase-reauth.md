---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

`deleteCurrentUserAccount` / `deleteCurrentUserAccountBridge` now re-authenticate
a Supabase caller against Supabase (`verifySupabaseAccountDeletionCredentials`)
when the caller passes no `verifyCredentials` hook (narduk-libs#1051). An app
that built its own delete route on the public helper used to fall through to the
local password-hash check, which a Supabase-provisioned user (no local hash)
skipped, so `{}` deleted the account. A principal without a session backend (an
API key) takes the app's backend, so on a Supabase app it fails closed with 401,
and the Supabase session it re-authenticates must belong to the account being
deleted: a key beside someone else's session cookie also gets 401.
`verifySupabaseAccountDeletionCredentials` takes an optional `{ userId }` for
the same binding, and a `verifyCredentials` hook now receives
`{ userId }` as its third argument, so passing that function as the hook keeps
the binding.
Supply `verifyCredentials` only to replace the check with your own.
