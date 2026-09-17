---
'@narduk-enterprises/narduk-logging': patch
---

Redact API-key and credential field names that survive punctuation-stripping,
such as `x-api-key`, `openai_api_key`, `AWS_SECRET_ACCESS_KEY`, and JWT
assertion headers.

Matching now splits the original key on camelCase, snake_case, and kebab-case
and treats `token`/`secret`/`jwt`/`bearer` as whole segments, so `tokenizer`,
`tokenization`, `secretary`, and `jwtid` stay visible. Compound infixes
(`apikey`, `accesskey`, `privatekey`, `authorization`) still match on the
punctuation-stripped key, so `x-api-key` and `AWS_SECRET_ACCESS_KEY` stay
redacted. `authorName`, `tokenCount`, `passwordless`, `authMethod`,
`authBackend`, and `authProvider` stay visible. An explicit `redact` extra list
still wins over those carve-outs. TypeScript, Python, and Swift stay in step.
