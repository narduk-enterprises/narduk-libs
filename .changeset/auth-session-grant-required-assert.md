---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-auth: the session-grant validator plugin refuses to start, and refuses
each request, while `runtimeConfig.nardukSessionGrantRequired` resolves to
anything but `true` (#1040). The module sets the flag at build time, but
`NUXT_NARDUK_SESSION_GRANT_REQUIRED=false` could override it at runtime without
anything noticing. The request check is there because Cloudflare applies env
overrides per request.
