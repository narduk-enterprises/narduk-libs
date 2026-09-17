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

The module now also stops its bundled dependencies from re-adding the tags
`useSeo` gave up. It sets `seo.automaticTwitterTags: false`, so nuxt-seo-utils'
`InferSeoMetaPlugin` no longer pushes a low-priority `twitter:card` into every
head while keeping its Open Graph inference, and
`ogImage.includeTwitter: false`, so nuxt-og-image stops emitting `twitter:card`,
`twitter:image`, `twitter:image:src`, `twitter:image:width`,
`twitter:image:height` and `twitter:image:alt` next to each generated
`og:image`. Both are plain `defu` defaults, so an app that wants the tags back
can set either option to `true`.
