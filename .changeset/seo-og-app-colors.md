---
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

An app can set the runtime OG card colours once, in `nuxt.config`, instead of
passing them to every `useSeo` call.

- `nardukSeo.ogImage: { primaryColor, secondaryColor }` is baked into
  `runtimeConfig.public.nardukSeoOgImageColors`, so
  `NUXT_PUBLIC_NARDUK_SEO_OG_IMAGE_COLORS_PRIMARY_COLOR` and
  `..._SECONDARY_COLOR` override it at runtime.
- Precedence, one colour at a time: `useSeo({ ogImage: { primaryColor } })`,
  then the app default, then the package default (`#10b981`, `#38bdf8`). An app
  that sets nothing renders exactly as before.
- A value that is not a `#rgb` or `#rrggbb` hex colour fails the build instead
  of silently falling back to the package default.
