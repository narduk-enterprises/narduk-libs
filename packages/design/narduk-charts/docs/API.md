# Public API overview

Local demos: `npm run dev` serves the marketing site + example routes; `npm run dev:playground` is the full control-panel lab. Static export: `npm run build:site` → `site/dist` (SPA; use a host that rewrites to `index.html` for deep links).

Types ship from `dist/index.d.ts`. Import paths:

- Full bundle: `import { NardukLineChart } from '@narduk-enterprises/narduk-charts'` + `import '@narduk-enterprises/narduk-charts/style.css'`
- Per-chart ESM: `import { NardukLineChart } from '@narduk-enterprises/narduk-charts/line'` (same stylesheet import as above); `@narduk-enterprises/narduk-charts/candle` for `NardukCandleChart` only; `@narduk-enterprises/narduk-charts/studies` for indicator math only (no Vue).

## Components

| Export | Summary |
|--------|---------|
| `NardukLineChart` | Category X, dual Y, zoom, optional `v-model:x-window` (sync with candle indices), annotations, `maxRenderPoints`, a11y props |
| `NardukBarChart` | Grouped / stacked / `stackedPercent`, shared a11y props |
| `NardukPieChart` | Donut, legend, keyboard slices |
| `NardukScatterChart` | Numeric X/Y series |
| `NardukHistogramChart` | `values` + `binCount` or explicit `bins` |
| `NardukCandleChart` | OHLC `bars`, zoom/pan/box/pinch, volume + brush, `v-model:domain`, `yScale` / `priceDisplayMode`, crosshair + axis time tag, last-price line, close trace, session grid, OHLC HUD, `highlightFormingBar`, `drawings` + `drawingTool` + `update:drawings`, `overlay` slot + `getCandlePlotMetrics()` |
| `NardukChartStack` | Layout wrapper with `v-model:domain` slot props for linked panes |

## Events (high level)

- Line: `pointClick`, `zoom`, `update:x-window` (when `v-model:x-window` used)
- Bar: `barClick`
- Pie: `sliceClick`
- Scatter: `pointClick`
- Candle: `zoom`, `update:domain`, `barClick`, `update:drawings`

## CSS variables

Defined in the published stylesheet (see `@theme` in source `src/styles/chart.css`): `--color-chart-text`, `--color-chart-muted`, `--color-chart-grid`, `--color-chart-axis`, `--color-chart-surface`, `--color-chart-accent`, tooltip tokens.

## Utilities

- `decimateCategoryData`, `computeHistogramBins`, `largestTriangleThreeBuckets`, `aggregateCandles` / `aggregateCandlesDetailed`, `candleTimeAtIndex` / `candleIndexAtTime`, `exportChartSvg` / `exportChartPng`, `useStreamingSeries`, `useCandleStream` (rolling OHLC, same-`t` replaces last bar)
- Studies: `sma`, `ema`, `vwap`, `bollinger`, `rsi`, `macd`; perf helpers: `recommendMaxDrawBars`, `suggestCandleRenderStrategy`
- `createYAxisMap` / `dataValueFromBottomPx` (`yScale.ts`) for custom overlays

## Versioned types

- `ChartLineAnnotationsV1` — alias of `ChartLineAnnotation[]` for migration tagging.
