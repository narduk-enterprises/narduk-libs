---
'@narduk-enterprises/narduk-realtime': patch
---

The live socket no longer installs a ping interval after `onState('open')` stopped it, and a reconnect started from `onState('closed')` is no longer torn down by the replaced connect timeout.
