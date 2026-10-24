---
'@narduk-enterprises/narduk-charts': patch
---

Update the line chart classic-output snapshots for happy-dom 21, which now
serializes the legend dot inline colour styles that happy-dom 20 dropped. No
rendered change: `ChartLegend` has always bound those styles.
