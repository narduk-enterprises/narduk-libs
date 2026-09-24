---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-app-tools': patch
---

`create-narduk-app upgrade` now writes only the top-level Workers Cache key on an existing `apps/web/wrangler.jsonc`. Bindings, routes and account stay app-owned. An explicit `cache.enabled: false` is left alone (narduk-libs#672).
