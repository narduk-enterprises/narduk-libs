---
'@narduk-enterprises/narduk-charts': patch
---

Add an NE Base design card (`src/design-cards/<Name>.card.vue`) for every
registered chart component (`NardukLineChart`, `NardukBarChart`,
`NardukPieChart`, `NardukScatterChart`, `NardukHistogramChart`,
`NardukCandleChart`, `NardukChartStack`, `NardukBrandBackdrop`), completing the
suite bar's last requirement alongside the existing README sections and
mount/SSR tests. `scripts/check-component-surface.mjs` now checks this package
(components backlog item 22, narduk-libs#269).
