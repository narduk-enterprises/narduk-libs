---
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `sitemapUrlsFromListing(items, { loc, lastmod?, changefreq?, priority? })`
under `@narduk-enterprises/narduk-seo/shared/sitemapFromListing`: a pure helper
that turns a listing of entities into `@nuxtjs/sitemap` URL rows. It keeps input
order, skips items whose `loc` builder returns a blank value, dedupes by `loc`
(first wins) and normalises `lastmod` to an ISO string. The README gains a
"Programmatic SEO kit" section tying it to the structured-data composables and
the OG image pipeline (narduk-libs#375).
