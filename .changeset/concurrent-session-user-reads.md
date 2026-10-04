---
'@narduk-enterprises/narduk-auth': patch
---

`refreshSessionUser` starts the `auth_sessions` row read and the `users` row
read together instead of one after the other (narduk-libs#1397), since both
ids come from the unsealed cookie. A signed-in request now waits for the slower
of the two reads, not their sum. Authentication answers are unchanged: a
missing session row, a missing user row, an expired session row and a failing
read each end as they did (a missing session row discards the user read, even a
failing one), and the per-request memoization of both rows is untouched.
