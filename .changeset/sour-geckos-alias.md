---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-core': patch
---

Replace the template-era dynamic database aliases with the private
`#narduk-core/schema` and `#narduk-core/postgres-runtime` Nuxt contracts. Core
now derives secure session-cookie defaults from the request protocol so local
HTTP development remains usable while HTTPS stays secure. Auth's packaged
runtime now imports its own composables and server helpers explicitly, with
boundary checks that prevent implicit template-era auto-import dependencies from
returning.
