---
'@narduk-enterprises/narduk-seo': minor
---

Reads `Config/brand.json` at build. The runtime OG cards (`OgImageDefault`, `OgImageArticle`) are redrawn as brand cards in the brand's palette, layout, texture and mark with the page title as the largest element, replacing the generic gradient; `nardukSeo.ogImage` colours default to the brand's, and `theme-color` is emitted per colour scheme. Icon `<link>` tags (`favicon.ico`, `favicon.svg`, `favicon-32x32.png`, `apple-touch-icon.png`, `site.webmanifest`) are added for each file that exists in `public/`, never duplicating one the app declares. New options: `nardukSeo.brand` (path or `false`) and `nardukSeo.icons` (default `true`). An app without a brand file keeps its current colours.
