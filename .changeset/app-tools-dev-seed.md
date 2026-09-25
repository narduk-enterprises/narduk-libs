---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `narduk-app dev:seed`: loads `seed/{d1,kv,r2}/<BINDING>/` fixtures into
Wrangler's local D1/KV/R2 with the Cloudflare credential variables removed from
the child, so a checkout (or a cloud agent container) reaches a seeded local
environment with no production credential. Generated D1 apps get a starter
`apps/web/seed/` fixture and a `dev:seed` script (#378).
