---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-seo': patch
---

Setup fails the build when the resolved `@unhead/vue` is 3 or newer and the
resolved `nuxt-schema-org` is below 6.3.0 or `nuxt-seo-utils` is below 8.5.0.
That mix peers on Unhead 2 and silently empties JSON-LD and drops `og:site_name`
and the twitter tags. The app's own copies are what get checked, so an override
or a direct older dependency cannot hide behind this package's pins. Unhead 2
with the older packages still builds. A version that cannot be read fails
closed. The generator release picks up the new narduk-seo pin.
