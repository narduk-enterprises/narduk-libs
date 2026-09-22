---
'@narduk-enterprises/narduk-analytics': patch
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/narduk-tenancy': patch
'@narduk-enterprises/narduk-uploads': patch
---

`meta.compatibility.nuxt` now says `>=4.0.0`, matching the `nuxt` peer range
these modules already declare (#444). Before, the module metadata still claimed
`>=3.16.0`, so a Nuxt 3 app got no compatibility warning from Nuxt and failed
later instead. Nuxt 4 apps see no change.
