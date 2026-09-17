---
'@narduk-enterprises/narduk-logging': patch
---

Redact API-key and credential field names that survive punctuation-stripping,
such as `x-api-key`, `openai_api_key`, `AWS_SECRET_ACCESS_KEY`, and JWT
assertion headers.

Matching now treats `apikey`, `accesskey`, `privatekey`, `jwt`, `bearer`,
`credential`, `authorization`, and `token`/`password`/`secret` as substrings of
the normalized key, not only exact names or suffixes. `authorName`,
`tokenCount`, `passwordless`, `authMethod`, `authBackend`, and `authProvider`
stay visible. An explicit `redact` extra list still wins over those carve-outs.
