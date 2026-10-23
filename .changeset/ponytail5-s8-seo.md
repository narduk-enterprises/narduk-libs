---
'@narduk-enterprises/narduk-seo': patch
---

A non-HTTPS network directory URL now counts as unconfigured, so `/narduk-network` stays `noindex` and out of the sitemap. Sitemap `lastmod` values with no time zone are read as UTC. `useSoftwareApplicationSchema` keeps the app's own `url` and links `catalogUrl` as `isPartOf`. The README now states the real `publicCatalogBaseUrl` default.
