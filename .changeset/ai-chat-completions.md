---
'@narduk-enterprises/narduk-ai': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `server/utils/chatCompletions`: `chatCompletion` / `chatCompletionJson`, a
provider-neutral OpenAI-compatible chat client with `baseUrl`, `maxTokens`, JSON
mode, a per-attempt timeout, a 5xx/network retry, usage in the result and
sanitized H3 errors that never carry the raw provider body (#985). `grokChat` is
unchanged.
