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
API key) takes the app's backend, so on a Supabase app it fails closed with 401.
Supply `verifyCredentials` only to replace the check with your own.
