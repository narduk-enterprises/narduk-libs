---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/narduk-auth': patch
---

Fixes for the new error-severity lint rules. `LayerAppFooter` (narduk-core,
narduk-seo) no longer reads `new Date()` during render for the copyright year;
it reads one SSR-hydrated timestamp (`useSsrNow` in narduk-core, `useState` in
narduk-seo), so server and client agree. `GET /api/auth/api-keys` (narduk-auth)
is ordered newest first in SQL and limited to 100 keys, since nothing caps how
many keys a user may create.
