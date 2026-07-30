---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/create-narduk-app': patch
---

Import Nuxt runtime helpers explicitly in packaged analytics plugins so consumer
builds hydrate without relying on ambient package-source auto-import transforms.
