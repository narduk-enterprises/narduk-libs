---
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

Stop pinning `/_og/**` to `prerender: false`, so OG images for prerendered pages
are actually generated (narduk-libs#170).

`nuxt-og-image` emits an _unsigned_ `/_og/s/...` URL while a page is prerendered
and relies on the prerender crawler to bake that image to a file. The pin
stopped the file being produced, so the unsigned URL fell through to the runtime
handler, which rejects it with `403 Missing URL signature` as soon as a signing
secret is configured -- which every deployed build requires. SSR pages were
never affected; they take the signed `/_og/d/...` branch.

**This changes your build output.** Each prerendered page that renders a card
now writes one image file into the app's static assets, counting against the
Workers per-file size and total file-count ceilings, and build time grows with
the number of such pages. A baked card is exactly as stale as the page it was
built from, so a card that must track data moving between deploys does not
belong on a prerendered route. Apps that ship only a static `defaultOgImage` are
unaffected; set `ogImage.zeroRuntime: true` or `ogImage.enabled: false` as
before.
