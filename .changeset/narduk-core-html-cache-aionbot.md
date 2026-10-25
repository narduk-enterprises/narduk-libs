---
'@narduk-enterprises/narduk-core': minor
---

narduk-core: opt-in `nardukCore.htmlCache` (`{ routes, ttlSeconds }`, default 600)
serves anonymous GETs (no Cookie, no Authorization) from `caches.default` in
`render:before` and stores `200` renders with no `Set-Cookie`, keyed by build id
and host, with an `x-html-cache: hit | miss` header. The key path is normalized (dot segments, escapes), query strings render unless allow-listed with `queryKeys`, and the robots indexable gate is on by default (`requireIndexable`). It works on nonce-CSP apps
too (D-HTML-CACHE-PUBLIC-1): the page is stored with its nonce, a cookie request
always renders fresh, and `nonce-csp-cache` still forces `no-store` on responses. `AionBot` joins `DEFAULT_BLOCKED_BOTS` (about 43k requests a
day on austin-texas-net, 2026-10-25); other AI crawlers stay with narduk-seo's
`aiCrawlers`.
