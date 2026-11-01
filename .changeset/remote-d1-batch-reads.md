---
'@narduk-enterprises/narduk-app-tools': patch
---

`db migrate --remote` and `migrate-deployment` read D1 in one wrangler process per inspection batch instead of one per statement. A no-op promote migrate step drops from minutes to seconds (#2149).
