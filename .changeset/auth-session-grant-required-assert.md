---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: the session-grant validator plugin refuses to start while
`runtimeConfig.nardukSessionGrantRequired` resolves to anything but `true`
(#1040). The module sets the flag at build time, but
`NUXT_NARDUK_SESSION_GRANT_REQUIRED=false` could override it at runtime without
anything noticing. The validator is still attached to every request whatever the
per-request config says, so an override that only reaches request-time config
(possible on Cloudflare with older compatibility dates) still fails closed.
