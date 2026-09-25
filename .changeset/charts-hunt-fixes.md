---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-charts: `niceScale` no longer loops forever when a domain spans only a few ULPs (#927). It widens such a range the same way as `min === max`, and it builds ticks by index.

narduk-charts: domain and histogram math no longer spreads every value into `Math.min`/`Math.max`, which threw a RangeError past ~100k values (#929). Internal `arrayMin`/`arrayMax` loop helpers replace those calls.

narduk-charts: `useChart` starts observing its container again when `width` goes from set to unset (#934), so a chart that was pinned to a fixed width no longer sticks at 600px.

narduk-charts: `NardukBarChart` bars grow from zero instead of the domain floor (#928), so negative values hang below (or left of) the zero line. Stacked bars keep separate positive and negative totals, and the stacked domain covers both.
