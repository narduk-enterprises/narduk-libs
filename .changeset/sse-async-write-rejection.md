---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

`broadcastSSE` now removes a connection whose write rejects, which is how a closed or errored stream reports a client that went away. It used to catch only a synchronous throw, so a dead connection stayed on its channel and every later broadcast raised another unhandled rejection.
