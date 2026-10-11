---
'@narduk-enterprises/narduk-charts': minor
'@narduk-enterprises/create-narduk-app': patch
---

Opt-in studio look. `look="studio"` on `NardukLineChart` gives a frameless chart
with a left-aligned title, an inline line-key legend above the plot, hairline
horizontal grid, right-aligned tabular Y ticks with `yUnit` after the top tick,
monotone smoothing, a fade-gradient area, a now tag (ringed last-value dot plus
value chip in the right gutter, `showNowTag`), optional `endLabels`, `yBands` as
a wash with a right rail, projection bands paired to a series with
`ChartBand.series`, a crosshair with a ringed dot per series, and dark-mode
tokens. `ChartSeries.emphasis: 'context'` quiets a series. `look` is also
accepted on Bar, Scatter, Histogram, Pie and Candle for the frame CSS only;
their marks do not change. Classic remains the default and its output is
unchanged. X tick labels that would collide now thin so the last label wins, in
every look.
