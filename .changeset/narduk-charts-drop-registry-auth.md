---
'@narduk-enterprises/narduk-charts': patch
---

Removes the unused `tools/configure-package-registry-auth.mjs` (it read the retired package-read secret). It was never published (`files` is `dist` only).
