export type ChartTheme = 'default' | 'high-contrast' | 'print' | 'colorblind-safe'

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

/** Markers for line charts (category index + Y in data space). */
export type ChartLineAnnotation =
  | {
      type: 'vline'
      xIndex: number
      color?: string
      /** Default true (dashed vertical guide). */
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
