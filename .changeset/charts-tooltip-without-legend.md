---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/create-narduk-app': patch
---

`NardukLineChart` draws its cursor tooltip when `showLegend` is `false`. The
tooltip was nested inside the legend block, so hiding the legend also hid the
tooltip.
