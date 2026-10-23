---
'@narduk-enterprises/narduk-ai': patch
---

`grokChat` and `grokChatStream` give up on a silent provider after 30 seconds, an SSE error frame now fails the stream instead of ending it empty, and saving a system prompt that does not exist answers 404 instead of success.
