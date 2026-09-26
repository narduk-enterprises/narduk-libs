---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: a local-backend session now follows the users row's sign-in methods
(#1042). When a password has been set, or an Apple ID linked, since the cookie
was issued, the next request clears `needsPasswordSetup` and adds `email` or
`apple` to `authProviders`, and the refresh rewrites the cookie. In practice
this reaches other live sessions through Apple linking; setting a first
password by email link already signs every other session out. The refresh now compares `needsPasswordSetup`,
`authProvider`, `authProviders` and `emailConfirmedAt` as well as email, name,
isAdmin, recoveryMode and aal. Providers the row cannot see, such as a passkey
sign-in, are kept; Supabase-backend sessions are unchanged.
