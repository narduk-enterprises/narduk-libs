---
'@narduk-enterprises/narduk-core': minor
---

`getClientIp` accepts `trustFlyClientIp`, which declares the Fly.io proxy the
app's edge: it reads the proxy-set `fly-client-ip` header and ignores
`cf-connecting-ip` (client-writable without Cloudflare in front). Off by
default. It applies to direct `getClientIp` calls; the built-in `'ip'`
rate-limit scopes do not take it.
