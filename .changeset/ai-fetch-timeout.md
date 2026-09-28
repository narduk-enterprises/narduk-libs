---
'@narduk-enterprises/narduk-ai': patch
---

`grokListModels` now times out after 10s instead of waiting indefinitely on a stalled xAI; the timeout rejects the same way a network failure does.
