---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Supabase logout now revokes only the current session upstream. `POST
/api/auth/logout` called `signOut()` with no options, and `@supabase/auth-js`
defaults that to `{ scope: 'global' }`, which revoked every session the user
held at the authority: their other devices, and every other app on the same
Supabase project, were signed out within one revalidation window. It now calls
`signOut({ scope: 'local' })` (narduk-libs#921). The local backend is unchanged.
