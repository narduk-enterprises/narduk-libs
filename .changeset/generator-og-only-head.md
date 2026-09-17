---
'@narduk-enterprises/create-narduk-app': patch
---

The scaffolded no-seo `nuxt.config.ts` head drops its `twitter:card` and
`twitter:image` meta entries and keeps the full Open Graph set, including
`og:image:width` / `og:image:height`. A fresh app therefore starts clean against
the shared browser-console contract instead of emitting tags Unhead 3 reports as
deprecated (narduk-libs#349).
