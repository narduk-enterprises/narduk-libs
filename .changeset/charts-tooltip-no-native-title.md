---
'@narduk-enterprises/narduk-charts': patch
'@narduk-enterprises/create-narduk-app': patch
---

Charts no longer show a native browser tooltip over the whole plot: the SVG accessible name and description now live in hidden label targets instead of `<title>`/`<desc>`. The cursor tooltip is capped at `--size-chart-tooltip-max` (20rem, at most 75% of the chart) and wraps long series names, with a long value dropping to its own line.
