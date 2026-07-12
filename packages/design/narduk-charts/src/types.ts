export type ChartTheme = 'default' | 'high-contrast' | 'print' | 'colorblind-safe'

export type ChartXAxisType = 'category' | 'time'

/** Primary = left Y-axis; secondary = right Y-axis when `dualYAxis` is enabled. */
export type ChartYAxisId = 'primary' | 'secondary'

/** Linear, log10 (strictly positive values), or symmetric log (mixed signs). */
export type ChartYScaleMode = 'linear' | 'log' | 'symlog'

export interface ChartSeries {
  name: string
  /** Use `null` to break the line (gap) at that index. */
  data: (number | null)[]
  color?: string
  /**
   * When the chart enables dual Y-axes, attach series to the left (`primary`)
   * or right (`secondary`) scale. Defaults to `primary`.
   */
  yAxis?: ChartYAxisId
}

export interface ChartReferenceLine {
  value: number
  label?: string
  color?: string
  /** Draw with a dashed stroke (default true). */
  dashed?: boolean
  /** Which scale to use when `dualYAxis` is true. Default `primary`. */
  yAxis?: ChartYAxisId
}

/** Horizontal band between two Y values (data space). Drawn behind the series. */
export interface ChartYBand {
  y0: number
  y1: number
  color?: string
  /** 0–1; default 0.12 */
  opacity?: number
  label?: string
  yAxis?: ChartYAxisId
}

/**
 * Markers for line charts (category index + Y in data space).
 * On **bar charts**, `vline` is vertical at the category in default orientation;
 * with `orientation: 'horizontal'` it renders as a horizontal guide at that category row.
 */
export type ChartLineAnnotation =
  | {
      type: 'vline'
      xIndex: number
      color?: string
      /** Default true (dashed guide: vertical in default bar orientation, horizontal when `orientation` is `horizontal`). */
      dashed?: boolean
      label?: string
    }
  | {
      type: 'point'
      xIndex: number
      y: number
      color?: string
      label?: string
      yAxis?: ChartYAxisId
    }
  | {
      type: 'label'
      xIndex: number
      y: number
      text: string
      color?: string
      yAxis?: ChartYAxisId
      dx?: number
      dy?: number
    }

export interface LinePointClickPayload {
  index: number
  label: string
  values: { seriesName: string; value: number | null }[]
}

/** Fractional X domain along category indices (`0` … `labels.length - 1`). */
export interface LineZoomRange {
  start: number
  end: number
}

export interface BarClickPayload {
  index: number
  label: string
  seriesName: string
  value: number
}

/**
 * Public props for {@link NardukLineChart} (for typing wrapper components and documentation).
 * The SFC mirrors this shape in `defineProps`.
 */
export interface NardukLineChartProps {
  series: ChartSeries[]
  labels: string[]
  width?: number
  height?: number
  smooth?: boolean
  showGrid?: boolean
  showPoints?: boolean
  showArea?: boolean
  colors?: string[]
  animate?: boolean
  dark?: boolean
  respectReducedMotion?: boolean
  referenceLines?: ChartReferenceLine[]
  theme?: ChartTheme
  dualYAxis?: boolean
  yScale?: ChartYScaleMode
  yScaleSecondary?: ChartYScaleMode
  /** Include zero in positive linear Y domains. Disable for relative trend/detail charts. */
  linearFromZero?: boolean
  /** Add proportional headroom/footroom to linear Y domains. */
  linearPaddingRatio?: number
  symlogLinthresh?: number
  yBands?: ChartYBand[]
  annotations?: ChartLineAnnotation[]
  zoomable?: boolean
  zoomAutoY?: boolean
  zoomMinPoints?: number
  chartTitle?: string
  chartDescription?: string
  showDataTable?: boolean
  legendGroupLabel?: string
  dir?: 'ltr' | 'rtl'
  formatXLabel?: (label: string, index: number) => string
  formatTickValue?: (value: number) => string
  maxRenderPoints?: number
  /** Controlled fractional X window for `v-model:x-window`. */
  xWindow?: LineZoomRange
  /** Default `'category'`; use `'time'` with `times` for dense timestamp axes. */
  xAxisType?: ChartXAxisType
  /** Unix milliseconds aligned with `labels` and series values when `xAxisType` is `'time'`. */
  times?: number[]
  /** Timestamp formatter for time axes. */
  formatTime?: (timestamp: number) => string
  /** Minimum horizontal label spacing. Defaults to 112px for time axes and 50px for category axes. */
  xAxisMinLabelPx?: number
  /** Override chart padding, useful for compact axis-free previews. */
  padding?: Partial<ChartPadding>
  /** Card border/shadow/background wrapper styling. `false` for decorative/sparkline usage. */
  chrome?: boolean
  /** Built-in hover/keyboard-focus cursor tooltip. */
  showTooltip?: boolean
  /** Keyboard focusability/interaction on the SVG root. `false` marks it `aria-hidden` and removes `tabindex`. */
  focusable?: boolean
}

/** `NardukBarChart` layout: categories on X (default) or on Y for long labels / leaderboards. */
export type NardukBarChartOrientation = 'vertical' | 'horizontal'

/**
 * Public props for {@link NardukBarChart} (for typing wrapper components and documentation).
 * The SFC mirrors this shape in `defineProps`.
 */
export interface NardukBarChartProps {
  series: ChartSeries[]
  labels: string[]
  width?: number
  height?: number
  stacked?: boolean
  stackedPercent?: boolean
  colors?: string[]
  animate?: boolean
  barRadius?: number
  dark?: boolean
  respectReducedMotion?: boolean
  referenceLines?: ChartReferenceLine[]
  theme?: ChartTheme
  yScale?: ChartYScaleMode
  symlogLinthresh?: number
  yBands?: ChartYBand[]
  annotations?: ChartLineAnnotation[]
  chartTitle?: string
  chartDescription?: string
  showDataTable?: boolean
  legendGroupLabel?: string
  dir?: 'ltr' | 'rtl'
  formatXLabel?: (label: string, index: number) => string
  formatTickValue?: (value: number) => string
  /** Default `'vertical'`. `'horizontal'` places categories on the Y axis and bars along +X. */
  orientation?: NardukBarChartOrientation
  /**
   * When `orientation` is `horizontal`, max width (px) for the left category
   * gutter. Layout uses `min(estimated, cap)` (minimum gutter 32px).
   */
  categoryLabelMaxWidth?: number
}

export interface PieSliceClickPayload {
  label: string
  value: number
  percentage: number
}

export interface PieDataItem {
  label: string
  value: number
  color?: string
}

export interface ChartPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface TooltipItem {
  color: string
  label: string
  value: string
}

export interface LegendItem {
  name: string
  color: string
  hidden: boolean
}

/** Version-stable alias for line chart `annotations` arrays (migration tags). */
export type ChartLineAnnotationsV1 = ChartLineAnnotation[]

export interface ScatterPoint {
  x: number
  y: number
  label?: string
}

export interface ScatterSeries {
  name: string
  points: ScatterPoint[]
  color?: string
}

export interface HistogramBin {
  start: number
  end: number
  count: number
}

/** OHLC bar; `t` is open time (Unix ms). */
export interface CandleBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v?: number
}

/** Visible X domain in time (ms) plus fractional bar indices (same semantics as line zoom). */
export interface CandleZoomRange {
  startTime: number
  endTime: number
  startIndex: number
  endIndex: number
}

/** Controlled viewport for syncing multiple charts (`v-model:domain`). */
export interface CandleTimeDomain {
  start: number
  end: number
}

export interface CandleClickPayload {
  index: number
  bar: CandleBar
}

/** Emitted when the visible domain's start nears the earliest loaded bar (left-edge load-more). */
export interface CandleReachedStartPayload {
  earliestTime: number
}

/**
 * `percent`: (price / ref − 1) × 100 vs first visible close.
 * `indexed`: price / ref × 100 vs first visible close.
 */
export type CandlePriceDisplayMode = 'absolute' | 'percent' | 'indexed'

/** `candle` filled bodies; `hollow` bullish hollow / bearish filled (TradingView-style); `bar` OHLC ticks. */
export type CandleBarStyle = 'candle' | 'hollow' | 'bar'

/** Read-only layout + mappers from `NardukCandleChart` (`defineExpose` / overlay slot). */
export interface CandlePlotMetrics {
  chartWidth: number
  chartHeight: number
  padding: { top: number; right: number; bottom: number; left: number }
  plotWidth: number
  priceInnerHeight: number
  xViewMin: number
  xViewMax: number
  yDomain: { min: number; max: number }
  /** Fractional bar index from SVG X inside the chart. */
  indexFromSvgX: (svgX: number) => number
  xPos: (index: number) => number
  /** Pixel Y for an OHLC value in raw price space (applies `priceDisplayMode`). */
  priceYFromRaw: (ohlcPrice: number) => number
  /** Interpolated open time (ms) at fractional bar index. */
  timeAtIndex: (index: number) => number
  /** Raw OHLC price from a Y coordinate in the price pane (outside → NaN). */
  rawFromPlotY: (svgY: number) => number
}

export interface CandleTrendLineDrawing {
  id: string
  type: 'trend'
  tStart: number
  priceStart: number
  tEnd: number
  priceEnd: number
}

export interface CandleHorizontalRayDrawing {
  id: string
  type: 'horizontal'
  price: number
}

/** Fib retracement between two anchors; levels span [min(price), max(price)] along Y. */
export interface CandleFibRetracementDrawing {
  id: string
  type: 'fib_retracement'
  tStart: number
  priceStart: number
  tEnd: number
  priceEnd: number
}

/** Price/time rectangle (two-corner drag). Serialized for persistence. */
export interface CandleRangeBoxDrawing {
  id: string
  type: 'range'
  tStart: number
  tEnd: number
  priceTop: number
  priceBottom: number
}

export type CandleDrawing =
  | CandleTrendLineDrawing
  | CandleHorizontalRayDrawing
  | CandleFibRetracementDrawing
  | CandleRangeBoxDrawing

export type CandleDrawingTool =
  | 'trend'
  | 'horizontal'
  | 'fib_retracement'
  | 'range'
  | null

export interface ExportChartOptions {
  filename?: string
  /** PNG pixel ratio vs SVG nominal size (default 2). */
  scale?: number
  /**
   * CSS text inlined into a cloned SVG (e.g. contents of `narduk-charts/style.css`)
   * so PNG rasterization preserves colors/strokes.
   */
  embeddedCss?: string
}
