import './styles/chart.css'

/**
 * Public surface for `narduk-charts`.
 * Alerts, bar replay, broker/DOM, Pine, multi-chart cloud sync, and social feeds are intentionally out of scope.
 * Undocumented internals (`useChart`, `ChartTooltip`, …) are not semver-stable unless exported here.
 */

/** Category line / area chart: dual Y, zoom, annotations, bands. */
export { default as NardukLineChart } from './components/NardukLineChart.vue'
/** Vertical bars: grouped, stacked, percent stacks. */
export { default as NardukBarChart } from './components/NardukBarChart.vue'
/** Pie or donut with legend + tooltips. */
export { default as NardukPieChart } from './components/NardukPieChart.vue'
/** Numeric scatter plot. */
export { default as NardukScatterChart } from './components/NardukScatterChart.vue'
/** Histogram from samples or explicit bins. */
export { default as NardukHistogramChart } from './components/NardukHistogramChart.vue'
/** OHLCV time-series: zoom, volume, brush, drawings, domain sync. */
export { default as NardukCandleChart } from './components/NardukCandleChart.vue'
/** Layout helper forwarding `v-model:domain` for stacked panes. */
export { default as NardukChartStack } from './components/NardukChartStack.vue'
/** Optional marketing / hero backdrop: SVG grid + series (uses chart CSS variables; no images). */
export { default as NardukBrandBackdrop } from './components/NardukBrandBackdrop.vue'

/** Rolling `number[]` buffer for live scalar charts. */
export { useStreamingSeries } from './composables/useStreamingSeries'
export type { StreamingSeriesOptions } from './composables/useStreamingSeries'
/** Rolling `CandleBar[]` buffer; replaces forming bucket when `t` matches. */
export { useCandleStream } from './composables/useCandleStream'
export type { CandleStreamOptions } from './composables/useCandleStream'
/** Browser fullscreen helper for a chart container element. */
export { useChartFullscreen } from './composables/useChartFullscreen'

/** SVG snapshot helpers for PNG/PDF workflows. */
export {
  getChartSvgElement,
  serializeChartSvg,
  exportChartSvg,
  exportChartPng,
} from './utils/exportChart'

export { chartThemeClass } from './utils/chartTheme'

export { createYAxisMap, dataValueFromBottomPx } from './utils/yScale'
export type { YAxisMapResult } from './utils/yScale'

export {
  decimateCategoryData,
  computeHistogramBins,
  largestTriangleThreeBuckets,
  aggregateCandles,
  aggregateCandlesDetailed,
  candleTimeAtIndex,
  candleIndexAtTime,
} from './utils/math'

export {
  aggregateCandlesToResolution,
  resolutionMsFromId,
  CANDLE_RESOLUTION_MS,
  CANDLE_RESOLUTION_LABEL,
} from './utils/candleResolution'
export type { CandleResolutionId } from './utils/candleResolution'

export {
  sma,
  ema,
  vwap,
  bollinger,
  rsi,
  macd,
} from './studies'
export type { BollingerBandRow } from './studies'

export {
  recommendMaxDrawBars,
  suggestCandleRenderStrategy,
} from './perf/candleRenderBudget'
export type { CandleRenderStrategy } from './perf/candleRenderBudget'
export type {
  DecimatedCategoryData,
  XYPoint,
  AggregatedCandleBucket,
} from './utils/math'

export type {
  ChartSeries,
  PieDataItem,
  TooltipItem,
  LegendItem,
  ChartPadding,
  ChartReferenceLine,
  ChartTheme,
  ChartYAxisId,
  ChartYScaleMode,
  ChartYBand,
  ChartLineAnnotation,
  LinePointClickPayload,
  LineZoomRange,
  BarClickPayload,
  PieSliceClickPayload,
  ExportChartOptions,
  ChartLineAnnotationsV1,
  ScatterPoint,
  ScatterSeries,
  HistogramBin,
  CandleBar,
  CandleZoomRange,
  CandleTimeDomain,
  CandleClickPayload,
  CandlePriceDisplayMode,
  CandlePlotMetrics,
  CandleDrawing,
  CandleTrendLineDrawing,
  CandleHorizontalRayDrawing,
  CandleFibRetracementDrawing,
  CandleRangeBoxDrawing,
  CandleDrawingTool,
  CandleBarStyle,
} from './types'
