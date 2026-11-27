---
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/create-narduk-app': patch
---

NeCsvDownload: the accessible name keeps the visible `label` (WCAG 2.5.3, axe `label-content-name-mismatch`). A label the default "Download N rows as CSV" does not contain now leads it, as "Download sources CSV (10 rows)"; the default "CSV" label reads as before.
