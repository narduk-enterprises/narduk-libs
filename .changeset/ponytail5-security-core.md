---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Security fixes: the layer session cookie is `Secure` unless the Host is `localhost` or `127.0.0.1` over plain HTTP (narduk-libs#2001); the CSRF skip for API keys accepts every `Authorization` spelling the key parser accepts; the `SESSION_PASSWORD` alias is seeded into `runtimeConfig.session.password` like `NUXT_SESSION_PASSWORD`; `enforceRateLimitPolicy` keys on `cf-connecting-ip` or the socket and no longer trusts the first `X-Forwarded-For` entry, and a throwing Cloudflare rate-limit binding falls back to the in-isolate limiter instead of a 500.
