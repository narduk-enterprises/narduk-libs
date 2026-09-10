---
'@narduk-enterprises/narduk-core': minor
---

Export `getClientIp` from `server/utils/client-ip` so consuming apps attribute
rate limits, lockouts and audit rows to the same address the layer's own rate
limiter uses, instead of re-implementing it (or, as mybo-at-v2#30 did, reaching
for h3's `getRequestIP`, which never reads `cf-connecting-ip` and with
`xForwardedFor: true` trusts the first forwarded entry — the one Cloudflare
leaves as the client wrote it).

Order: `cf-connecting-ip`, then the first `x-forwarded-for` entry **only when
`trustForwardedFor` is set**, then h3's own view of the socket. `rateLimit.ts`
now calls it with `trustForwardedFor: true` so its behaviour is unchanged; new
consumers get the safe default.
