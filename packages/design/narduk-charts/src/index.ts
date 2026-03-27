import './styles/chart.css'

/** Alerts, bar replay, broker/DOM, Pine, multi-chart cloud sync, and social feed are intentionally out of library scope. */

export { default as NardukLineChart } from './components/NardukLineChart.vue'
export { default as NardukBarChart } from './components/NardukBarChart.vue'
export { default as NardukPieChart } from './components/NardukPieChart.vue'
export { default as NardukScatterChart } from './components/NardukScatterChart.vue'
export { default as NardukHistogramChart } from './components/NardukHistogramChart.vue'
export { default as NardukCandleChart } from './components/NardukCandleChart.vue'
export { default as NardukChartStack } from './components/NardukChartStack.vue'

export { useStreamingSeries } from './composables/useStreamingSeries'
export type { StreamingSeriesOptions } from './composables/useStreamingSeries'
export { useCandleStream } from './composables/useCandleStream'
export type { CandleStreamOptions } from './composables/useCandleStream'
export { useChartFullscreen } from './composables/useChartFullscreen'

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
