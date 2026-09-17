---
'@narduk-enterprises/narduk-shell': patch
---

Format `NePager` and `NeSectionHeader` counts through pinned `en-US`
`formatNumber` so SSR cannot pick up the host locale's grouping.
