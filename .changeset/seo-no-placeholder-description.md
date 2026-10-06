---
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-seo no longer defaults `site.description` to "A Nuxt 4 application deployed on Cloudflare Workers." — that placeholder shipped as the meta description of every page that set none of its own. With no description configured, no description tag is emitted (#1442). `/narduk-network` is now left out of the sitemap and renders `noindex, follow` until a `networkDirectoryUrl` is configured.
