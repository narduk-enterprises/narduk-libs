---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`narduk-app verify --live` retries a Cloudflare challenge once through an egress
proxy.

A deploy runner on a datacentre address is answered `403` with
`cf-mitigated: challenge` by Bot Fight Mode on a client's Free-plan zone, so the
promote live proof fails on a good release (harmony-hot-sauce#148). With
`NARDUK_APP_EGRESS_PROXY=http://host:port` set (an HTTP CONNECT proxy, for
example the estate's residential egress on fleet CT 630), a request answered
exactly `403` + `cf-mitigated: challenge` is retried once through the proxy.
Nothing else is retried or proxied. With no proxy, an invalid one, or a proxy
that fails, the direct `403` stands and the proof fails as before.

The report records `egress: "direct" | "residential"` (JSON and text), with
`egressDetail` when a request was challenged. The retry shares the proof's
deadline. New export `@narduk-enterprises/narduk-app-tools/egress`:
`createChallengeFallbackFetch` for an app's own post-deploy script,
`createProxyFetch`, `resolveEgressProxy`. `live-dns.ts` now exports
`createNodeFetch`, the redirect-following node-http fetch that
`createPinnedFetch` is built on.
