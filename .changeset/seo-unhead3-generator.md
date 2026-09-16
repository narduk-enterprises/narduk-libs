---
'@narduk-enterprises/create-narduk-app': patch
---

Stop overriding `nuxt-og-image` to 6.7.2 in generated SEO apps, so they use the
release that `@narduk-enterprises/narduk-seo` pins. New apps now pin Nuxt 4.5.2,
which supplies Unhead 3 for that module set's `treeShakeUseSeoMeta` transform,
and Tailwind 4.3.2, whose Vite plugin supports Nuxt 4.5's Vite 8.
