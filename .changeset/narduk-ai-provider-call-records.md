---
'@narduk-enterprises/narduk-ai': patch
'@narduk-enterprises/create-narduk-app': patch
---

Record AI provider calls through an injected logger. `chatCompletion` takes a `logger` option, and
`grokChat`, `grokChatStream` and `grokListModels` take an optional trailing `{ logger }`; each call
then writes one record with the provider host, operation, model, status, duration, attempts and
token usage (a warn per retry, an error on the final failure with its reason). Records never hold
the API key, messages, model output or the provider's error text. Without a logger nothing is
written. The admin model route now records its xAI model listing through narduk-core's request
logger.
