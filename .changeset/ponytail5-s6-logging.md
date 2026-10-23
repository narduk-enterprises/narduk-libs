---
'@narduk-enterprises/narduk-logging': patch
---

A `flush()` called while a drain is running now also sends the records queued since that drain began.
