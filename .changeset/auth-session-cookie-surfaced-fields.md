---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: a local-backend session now follows the users row's sign-in methods
(#1042). When a password has been set, or an Apple ID linked, since the cookie
was issued (for example from another device), the next request clears
`needsPasswordSetup` and adds `email` or `apple` to `authProviders`, and the
refresh rewrites the cookie. The refresh now compares `needsPasswordSetup`,
`authProvider`, `authProviders` and `emailConfirmedAt` as well as email, name,
isAdmin, recoveryMode and aal. Providers the row cannot see, such as a passkey
sign-in, are kept; Supabase-backend sessions are unchanged.
