---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

`GET /api/auth/session/exchange` now enforces the `authLogin` rate limit, like its POST twin. Before this, the GET route ran the Supabase code and `token_hash` exchange without any throttle (narduk-libs#879).
