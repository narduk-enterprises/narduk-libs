---
'@narduk-enterprises/narduk-seo': minor
---

Emit Open Graph only: `useSeo` and the default social-image plugin no longer
render `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`,
`twitter:image:alt` or `twitter:site`. X reads `og:*` when no `twitter:` tag is
present, and Unhead 3 reports every `twitter:*` meta name — `twitter:card`
included — as deprecated, which turned the shared browser-console contract red
on every route of every consumer (narduk-libs#349,
narduk-enterprises/buoys#111).

`useSeo` now also declares `og:image:width` / `og:image:height` alongside a
static `image`, defaulting to the 1200x630 card and overridable with the new
`imageWidth` / `imageHeight` options; Unhead warns on an `og:image` with no
declared dimensions, and the generated-image path already declares its own.

`NUXT_PUBLIC_TWITTER_SITE` and `runtimeConfig.public.twitterSite` are still
accepted so existing deployments keep booting, but nothing reads them; the field
is marked `@deprecated`. The internal helper
`app/utils/resolvePublicTwitterSite.ts` is removed with its only caller.
