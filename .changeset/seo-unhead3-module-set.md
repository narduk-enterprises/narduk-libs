---
'@narduk-enterprises/narduk-seo': minor
---

Move the bundled Nuxt SEO modules to one coordinated set that supports both
Unhead 2 (Nuxt 4.4) and Unhead 3 (Nuxt 4.5): `@nuxtjs/robots` 6.2.3,
`@nuxtjs/sitemap` 8.5.1, `nuxt-link-checker` 5.3.0, `nuxt-og-image` 6.8.0,
`nuxt-schema-org` 6.3.2, `nuxt-seo-utils` 8.5.1 and `nuxt-site-config` 4.2.3.
The set no longer installs `image-size`, `@unhead/addons` or
`@unhead/schema-org`.

To adopt it, remove app overrides that pin `nuxt-seo-utils`, `nuxt-og-image`,
`@nuxtjs/seo` or `nuxtseo-shared` to older releases. If the app imports
`#sitemap/types`, set its own `@nuxtjs/sitemap` to 8.5.1.

Rendered head changes to expect, all verified against a real app on Nuxt 4.4.8
and on Nuxt 4.5.2:

- `nuxt-seo-utils` 8.5 defaults to `minify: { build: true, runtime: false }`, so
  head content injected at runtime (for example Nuxt UI's inline color styles)
  is no longer minified in the SSR response. Set `seo: { minify: true }` to keep
  the old behaviour.
- `nuxt-seo-utils` 8.5 emits the full favicon set it discovers, with `type` and
  `sizes` attributes, rather than only `apple-touch-icon`.
- `nuxt-schema-org` 6.3.2 no longer emits a second `#organization` node beside
  the `#identity` one. Assertions that matched the duplicate need updating.
- `nuxt-seo-utils` 8.5 runs its `treeShakeUseSeoMeta` transform only on Unhead
  3; on Unhead 2 it logs that it skipped the transform.
- `nuxt-seo-utils` 8.5 adds a build-time head validator that can report
  malformed or duplicate head tags.

OG image preview paths now carry the signature `nuxt-og-image` verifies, so
signed previews load when `security.secret` is set. Values containing `*` are
encoded the way `nuxt-og-image` 6.8.0 encodes them.
