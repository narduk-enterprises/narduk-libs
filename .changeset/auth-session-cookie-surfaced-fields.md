---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: the local-backend session refresh rewrites the session cookie
when any field it gives the client changes (#1042). It now checks
`needsPasswordSetup`, `authProvider`, `authProviders` and `emailConfirmedAt`
as well as email, name, isAdmin, recoveryMode and aal. Before, a change to one
of the new four left the client on the stale value until re-login.
