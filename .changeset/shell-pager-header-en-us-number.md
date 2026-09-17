---
'@narduk-enterprises/narduk-shell': patch
---

Format `NePager` and `NeSectionHeader` counts through pinned `en-US`
`formatNumber` so SSR cannot pick up the host locale's grouping. Tests spy
`Intl.NumberFormat` and require the locale argument to be `en-US`, so they fail
on the old host-default constructor even under an en-US CI locale.
