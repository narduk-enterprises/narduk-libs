# Public API overview

**NardukCharts** is the public product name; the installable package is
**`@narduk-enterprises/narduk-charts`**.

Local component lab: `npm run dev` (Histoire). Full-page examples, AAPL stream
demo, and static showcase routes live on the companion **charts** site at
[charts.nard.uk](https://charts.nard.uk), under **Documentation → Examples** and
**Showcase**.

Types ship from `dist/index.d.ts`. Import paths:

- Full bundle:
  `import { NardukLineChart } from '@narduk-enterprises/narduk-charts'` +
  `import '@narduk-enterprises/narduk-charts/style.css'`
- Per-chart ESM:
  `import { NardukLineChart } from '@narduk-enterprises/narduk-charts/line'`
  (same stylesheet import as above); `@narduk-enterprises/narduk-charts/candle`
  for `NardukCandleChart` only; `@narduk-enterprises/narduk-charts/studies` for
  indicator math only (no Vue); `@narduk-enterprises/narduk-charts/spark` for
  micro-sparkline axis, path, and 24h/7d/30d trailing-window helpers (no Vue).
  The same helpers are also re-exported from the package root.

## Components

| Export                 | Summary                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NardukLineChart`      | Category or adaptive time-series X, dual Y, zoom, optional `v-model:x-window` (sync with candle indices), annotations, `maxRenderPoints`, optional bottom volume histogram pane (`volume` + `showVolume` + `volumeFraction`, first series only—mirrors `NardukCandleChart`'s volume pane), a11y props, `chrome` / `showTooltip` / `focusable` for decorative/sparkline embedding |
| `NardukBarChart`       | Grouped / stacked / `stackedPercent`, shared a11y props                                                                                                                                                                                                                                                                                                                          |
| `NardukPieChart`       | Donut, legend, keyboard slices, `showLegend` / `showCenterLabel` / `showTooltip` toggles                                                                                                                                                                                                                                                                                         |
| `NardukScatterChart`   | Numeric X/Y series                                                                                                                                                                                                                                                                                                                                                               |
| `NardukHistogramChart` | `values` + `binCount` or explicit `bins`                                                                                                                                                                                                                                                                                                                                         |
| `NardukCandleChart`    | OHLC `bars`, zoom/pan/box/pinch, volume + brush, `v-model:domain`, `yScale` / `priceDisplayMode`, crosshair + axis time tag, last-price line, close trace, session grid, OHLC HUD, `highlightFormingBar`, `drawings` + `drawingTool` + `update:drawings`, `reachedStart` left-edge load-more, `overlay` slot + `getCandlePlotMetrics()`                                          |
| `NardukChartStack`     | Layout wrapper with `v-model:domain` slot props for linked panes                                                                                                                                                                                                                                                                                                                 |
| `NardukBrandBackdrop`  | Optional full-bleed SVG hero/marketing layer (grid + polylines + candle hints); reads `--color-chart-*` tokens, no bitmaps                                                                                                                                                                                                                                                       |

## Events (high level)

- Line: `pointClick`, `zoom`, `update:x-window` (when `v-model:x-window` used)
- Bar: `barClick`
- Pie: `sliceClick`, `sliceHover`
- Scatter: `pointClick`
- Candle: `zoom`, `update:domain`, `barClick`, `update:drawings`, `reachedStart`
  (left-edge load-more)

## CSS variables

Defined in the published stylesheet (see `@theme` in source
`src/styles/chart.css`): `--color-chart-text`, `--color-chart-muted`,
`--color-chart-grid`, `--color-chart-axis`, `--color-chart-surface`,
`--color-chart-frame`, `--color-chart-plot-tint`, `--color-chart-accent`,
`--color-chart-up` / `-down`, tooltip tokens, and the ten-slot categorical
palette `--color-chart-series-1` … `--color-chart-series-10`.

Series colors resolve to `var(--color-chart-series-N, <literal>)` unless a
`colors` prop is supplied, so `.narduk-chart--dark` and every preset `theme`
class repaint the data along with the chrome. `theme="colorblind-safe"` declares
eight hues separated by lightness as well as hue, wrapping slots 9–10 back to
1–2.

## Utilities

- `decimateCategoryData`, `computeHistogramBins`, `largestTriangleThreeBuckets`,
  `aggregateCandles` / `aggregateCandlesDetailed`, `candleTimeAtIndex` /
  `candleIndexAtTime`, `exportChartSvg` / `exportChartPng`,
  `useStreamingSeries`, `useCandleStream` (rolling OHLC, same-`t` replaces last
  bar)
- Studies: `sma`, `ema`, `vwap`, `bollinger`, `rsi`, `macd`; perf helpers:
  `recommendMaxDrawBars`, `suggestCandleRenderStrategy`
- `createYAxisMap` / `dataValueFromBottomPx` (`yScale.ts`) for custom overlays
- Micro-sparkline (`@narduk-enterprises/narduk-charts/spark`): `sparkAxis`,
  `sparkPath` (optional `times` for timestamp X), `trailingSparkWindow`,
  `sparkWindowMs`, `SPARK_WINDOWS` / `SPARK_WINDOW_MS` (24h / 7d / 30d)

## Versioned types

- `ChartLineAnnotationsV1` — alias of `ChartLineAnnotation[]` for migration
  tagging.
