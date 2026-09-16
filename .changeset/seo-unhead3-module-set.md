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
`#sitemap/types`, set its own `@nuxtjs/sitemap` to 8.5.1. `nuxt-seo-utils` 8.5
also adds a build-time head validator that can report malformed or duplicate
head tags.

OG image preview paths now carry the signature `nuxt-og-image` verifies, so
signed previews load when `security.secret` is set. Values containing `*` are
encoded the way `nuxt-og-image` 6.8.0 encodes them.
