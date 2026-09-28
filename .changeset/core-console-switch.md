---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Server warnings from the KV helpers (`kvGet`, `withKVCache`) and the dev-only nonce-CSP and preference cache warnings now go through the request logger (narduk-logging) instead of `console.warn`, so they carry the request ID and honour `LOG_LEVEL`; a logging failure never breaks the response.
