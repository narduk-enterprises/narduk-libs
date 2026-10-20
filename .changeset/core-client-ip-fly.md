---
'@narduk-enterprises/narduk-core': minor
---

`getClientIp` accepts `trustFlyClientIp`, which reads the Fly.io proxy's
`fly-client-ip` header after `cf-connecting-ip` and before `x-forwarded-for`.
Off by default. An app on Fly can now attribute requests to the proxy-set
address instead of trusting the client-writable first `x-forwarded-for` entry.
