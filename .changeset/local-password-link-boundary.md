---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Restrict self-serve password links to requests whose origin matches a configured
loopback app URL. Public deployments fail before issuing a token when the
development shortcut is enabled. Local Nuxt and Wrangler fixtures remain
supported.
