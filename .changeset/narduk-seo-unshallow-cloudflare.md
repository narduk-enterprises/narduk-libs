---
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/create-narduk-app': patch
---

Sitemap `<lastmod>` now reaches git-dated pages on Cloudflare builds. Workers
Builds and Pages clone with depth 1, so the module ran `git log` against no
history and skipped every page without a `useSeo({ modifiedAt })`. When
`WORKERS_CI` or `CF_PAGES` is set and the clone is shallow, it now runs
`git fetch --unshallow` first; a failed fetch still skips, as before.

create-narduk-app pins the new narduk-seo for generated apps.
