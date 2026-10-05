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
| `NardukChartStack`     | Layout wrapper with `v-model:domain` slot props for linked panes. For small multiples on independent scales, repeat `NardukLineChart` (`chrome: false`, `showLegend: false`) in your own grid instead                                                                                                                                                                            |
| `NardukBrandBackdrop`  | Optional full-bleed SVG hero/marketing layer (grid + polylines + candle hints); reads `--color-chart-*` tokens, no bitmaps                                                                                                                                                                                                                                                       |

## Sparse series, markers and thin bars (2.6.0)

All opt-in; nothing changes for a chart that sets none of them
(narduk-charts#37).

**`NardukLineChart` — per series (`ChartSeries`):**

- `spanGaps: true | number` — join values across `null`s. A number bridges only
  when the two values are at most that many label slots apart, so a 366-slot
  day-of-year series with `spanGaps: 40` never draws a line across a gap longer
  than 40 days. Measured in plotted slots (after `maxRenderPoints` decimation).
- `mode: 'points'` — a marker per value, no line or area.
- `marker: { radius?, filled? }` — `filled: false` draws a ring in the series
  colour over the plot background (`--color-chart-plot-tint`: white in the light
  theme).
- `opacity` — 0–1 for everything the series draws.
- `dashed: true | string` — a dashed line, for a projection beside a
  measurement. `true` is `6 4`; a string is an SVG `stroke-dasharray` in px. A
  dashed line skips the draw-in animation.
- `showValues` + `formatValue(value, index)` — always-visible value text above
  each point (drawn outside the plot clip).

**`NardukLineChart` — `bands` (a filled band between two time-varying series):**

`bands: ChartBand[]`, each `{ name, low, high, color?, opacity?, yAxis? }` with
`low` and `high` aligned index-for-index with `labels`. Use it for a range that
changes along X, such as a day-of-year 25th to 75th percentile "normal range";
`yBands` stays the fixed horizontal stripe.

- The fill sits behind the grid and the lines, inside the plot clip, in a
  low-opacity `color` (default `var(--color-chart-accent)`; `0.18`, `0.26` in
  the dark theme; `opacity` overrides it).
- A `null` or `NaN` in either array breaks the fill at that index, like a line
  gap; the band is never interpolated across it. An index where `low > high` is
  drawn with the edges swapped.
- Both edges take part in the Y domain (and the zoom-auto-Y window), with
  `maxRenderPoints` decimation, and `smooth` curves them like the lines.
- It has a legend entry (click to hide), a `low – high` tooltip row, a live
  summary part and a `showDataTable` low and high column.

**`NardukLineChart` — chart props and annotations:**

- `xTickIndices: number[]` — label exactly these category indices (e.g. month
  starts). A tick closer than `xAxisMinLabelPx` (default `36` here) to the
  previous kept one is skipped, so text keeps its real size on a narrow chart.
- `point` annotation `ring: true` — a ringed marker (`color` ring over the plot
  background) for a single value such as a season peak.
- Round Y steps need no new prop: pin the ends and set the count, e.g.
  `yMin: 0.2, yMax: 0.8, yTickCount: 7` for 0.1 steps (`(max − min) / step + 1`,
  up to 12).

**`NardukBarChart`:** `yMin` / `yMax` (value-axis pins, used exactly),
`showXAxis`, `showYAxis`, `showGrid`, `showLegend` (all default `true`) and
`padding`. With `orientation="horizontal"`, a `referenceLines` entry is a
vertical tick across the bar and a `yBands` entry spanning the domain is its
track — together a thin "% of normal" bar.

**Colours as CSS custom properties.** Any `color` may be `var(--your-token)`.
Series lines, fills and filled markers paint through the `fill` / `stroke`
attribute (resolved by Chromium and WebKit); a hollow marker's or ring's colour
goes on `style`, because the stylesheet sets `stroke` on markers and a
stylesheet rule outranks an attribute.

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
