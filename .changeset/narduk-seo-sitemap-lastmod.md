---
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

Sitemaps now carry a real per-page `<lastmod>` (narduk-libs#1414). Each page
takes the literal `modifiedAt` from its `useSeo()` call, else its file's last
commit date (one `git log` for all pages; skipped on shallow clones). Nothing
uses the build or request time, and a page with no trustworthy date gets no
`<lastmod>`. `definePageMeta({ sitemap: { lastmod } })` still wins. Opt out
with `nardukSeo: { sitemapLastmod: false }`.

create-narduk-app pins the new narduk-seo for generated apps.
