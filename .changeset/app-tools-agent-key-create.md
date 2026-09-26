---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-app-tools: add `narduk-app auth agent-key create` (narduk-libs#782). It
creates a non-login user (no password, an undeliverable `.invalid` address) and
an API key for it in one D1 batch, writing the `users` timestamps that hand SQL
left out. The raw key goes only to the stdin of the secret-sink command after
`--` (such as the guarded nvault setter), never to argv, stdout or a file, and D1
stores its SHA-256 hash. `--app-url` proves the key with `GET /api/auth/api-keys`
(401 without it, 200 or a missing-scope 403 with it). narduk-auth's README now
says `GET /api/auth/me` is session-only and names the endpoint that proves a key.
