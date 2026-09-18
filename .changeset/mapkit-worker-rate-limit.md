---
'@narduk-enterprises/narduk-mapkit': minor
---

Export §e.4's fixed-window token-route limiter,
`createMapKitFixedWindowRateLimit`, from the Worker-safe `/server` and `/worker`
entry points (narduk-libs#485). A Worker caller of `mapKitTokenResponseFromEnv`
can now pass the same limiter the 2.1 Nuxt module applies to its own route, as
`{ rateLimit }`. A new optional `key` names the bucket: the default is still the
routed origin, and a Worker can key per client, for example on
`cf-connecting-ip`. The Nuxt runtime re-exports the same function.
`mapKitTokenResponseFromEnv`'s default is unchanged: it applies no limiter
unless one is passed. Whether it should apply one by default is an open decision
on #485.
