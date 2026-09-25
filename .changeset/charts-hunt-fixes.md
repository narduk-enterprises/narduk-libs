---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-charts: `niceScale` no longer loops forever when a domain spans only a few ULPs (#927). It widens such a range the same way as `min === max`, and it builds ticks by index.

narduk-charts: domain and histogram math no longer spreads every value into `Math.min`/`Math.max`, which threw a RangeError past ~100k values (#929). The new `arrayMin`/`arrayMax` helpers replace those calls.
