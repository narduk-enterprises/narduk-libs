---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-core': patch
---

Narduk Data client: send `redirect: 'manual'` instead of `'error'`, which the
Cloudflare Workers runtime rejects before any response arrives. A redirect is
still an `http` failure and is never followed (#563).
