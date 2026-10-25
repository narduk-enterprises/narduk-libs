---
'@narduk-enterprises/narduk-core': patch
---

narduk-core: every `htmlCache` hit on a nonce-CSP app is re-stamped with the nonce
minted for that request (each stored `nonce=` is replaced, and the CSP header is built
from the same nonce), so cached pages never share a nonce.
