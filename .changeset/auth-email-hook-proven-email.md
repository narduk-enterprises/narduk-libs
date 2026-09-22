---
'@narduk-enterprises/narduk-auth': minor
'@narduk-enterprises/create-narduk-app': patch
---

Apps can brand the password setup and reset emails through the
`narduk-auth:email` Nitro hook. A template that throws or drops the link falls
back to the default email. `sendAuthEmail` sends an app's own account email,
such as an invitation, from the configured sender.
`registerLocalUserWithProvenEmail` and `confirmSessionEmailWithProof` create or
confirm an account for an address the app has just proven by redeeming a
single-use token it emailed there, so an invited person sets a password and is
in without a second confirmation email.
