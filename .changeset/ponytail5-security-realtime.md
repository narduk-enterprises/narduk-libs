---
'@narduk-enterprises/narduk-realtime': patch
---

The upgrade router opens a socket only for an explicit `{ ok: true }` authoriser verdict, and decodes static path segments before matching so `%61dmin` cannot skip a literal route for a later `:param` route.
