---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`verify --live --expect-sha` reads `x-build-version` from the health route when one is enabled. A prerendered smoke path (generated SEO apps prerender `/`) is a static asset and has no Worker header, so exact-SHA live proof no longer depends on that route (narduk-libs#781). `--no-health` still falls back to the smoke path.
