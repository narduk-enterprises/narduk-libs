---
'@narduk-enterprises/narduk-uploads': minor
---

Accept narduk-core 2 as a peer. The `@narduk-enterprises/narduk-core` peer range
widens from `>=1.19.15 <2.0.0` to `>=1.19.15 <3.0.0`. narduk-uploads does not
use Pinia, so narduk-core 2's move to Pinia 4 does not affect it. Apps still on
narduk-core 1 can keep taking narduk-uploads updates.
