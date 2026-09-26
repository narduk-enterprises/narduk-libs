---
'@narduk-enterprises/narduk-seo': patch
---

`ogImage: { enabled: false }` typechecks when `nuxt-og-image` is not installed. Static-card apps can opt out without `@ts-expect-error` and without `NUXT_OG_IMAGE_SECRET`.

Refs narduk-libs#1162
