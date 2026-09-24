---
'@narduk-enterprises/narduk-charts': minor
'@narduk-enterprises/create-narduk-app': patch
---

Carry the options the retired standalone narduk-charts repository published as
2.6.0 on 2026-09-23: line-series `spanGaps`, `mode: 'points'`, `marker`
(`radius`, `filled: false` rings), `opacity` and `showValues` / `formatValue`;
point annotations' `ring`; `xTickIndices` with thinning on narrow charts; and
bar `yMin` / `yMax`, `showXAxis`, `showYAxis`, `showGrid`, `showLegend` and
`padding`. narduk-libs continues from 2.6.0, the registry's `latest`, so this
release is the first to ship those options together with narduk-libs' 2.5.x
fixes and the `./spark` export. The package docs now name narduk-libs as the
only source and release path. `create-narduk-app` releases alongside because it
pins narduk-charts.
