---
'@narduk-enterprises/narduk-devices': patch
---

The opportunistic prune in `openSession` and `startClaim` runs at most once per
interval per database object: the shorter of the challenge TTL and the shortest
lockout window, five minutes by default (#227). A device polling `startClaim`
every 5 s for 15 minutes used to cost 540 `DELETE`s, almost all of them removing
nothing. It now costs three prunes. `pruneExpired()` is unchanged and always
runs.
