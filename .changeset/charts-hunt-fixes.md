---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-charts: `niceScale` no longer loops forever when a domain spans only a few ULPs (#927). It widens such a range the same way as `min === max`, and it builds ticks by index.
