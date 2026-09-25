---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

`POST /api/auth/api-keys` now refuses, with 403, to let an API-key caller mint a
scope it does not hold itself. A key holding only `auth:api-keys:write` can no
longer mint a wildcard (`*`) key; `*` is mintable only by a key that holds `*`.
Session-authenticated users are unaffected (narduk-libs#858).
