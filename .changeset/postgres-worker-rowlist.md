---
'@narduk-enterprises/narduk-postgres': patch
---

The ./worker example spreads postgres.js `RowList` into a plain `Row[]` so
`SqlExecutor` does not leak the driver type.
