---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/create-narduk-app': patch
---

Refuse a never-expiring wildcard API key and cap its lifetime at 90 days
(narduk-libs#168). `create-narduk-app` is a companion patch so the generator
pin moves with auth.
