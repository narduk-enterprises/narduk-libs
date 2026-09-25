---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

HEAD-as-GET now carries the caller's socket address to the inner GET as Nitro
`_platform.clientAddress` context, not as a synthesised `cf-connecting-ip`
header. A route that trusts `x-forwarded-for` now resolves a HEAD to the same
client as its GET, where before every client behind a proxy shared the proxy's
bucket for HEAD. The default configuration keeps its per-socket identity, and no
client-settable input gains precedence (narduk-libs#683).
