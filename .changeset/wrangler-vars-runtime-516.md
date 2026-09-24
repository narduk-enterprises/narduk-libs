---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Bridge wrangler.json vars into Nuxt public runtime config at build so Workers
Builds apps do not have to hand-roll a reader (narduk-libs#516).
