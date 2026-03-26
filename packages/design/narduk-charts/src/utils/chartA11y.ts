import type { CandleBar, ChartSeries, ScatterSeries } from '../types'
import { formatValue } from './math'

/** Default accessible name when the consumer does not pass one. */
export function defaultLineChartLabel(series: ChartSeries[], categoryCount: number): string {
  if (categoryCount <= 0) return 'Empty line chart'
  const names = series.map(s => s.name).filter(Boolean)
  if (names.length === 0) return `Line chart, ${categoryCount} categories`
  return `Line chart: ${names.join(', ')}`
}

export function defaultBarChartLabel(series: ChartSeries[], categoryCount: number): string {
  if (categoryCount <= 0) return 'Empty bar chart'
  const names = series.map(s => s.name).filter(Boolean)
  if (names.length === 0) return `Bar chart, ${categoryCount} categories`
  return `Bar chart: ${names.join(', ')}`
}

export function defaultPieChartLabel(labels: string[]): string {
  if (labels.length === 0) return 'Empty pie chart'
  return `Pie chart: ${labels.join(', ')}`
}

export function linePointSummary(
  label: string,
  series: ChartSeries[],
  index: number,
): string {
  const parts = series.map((s) => {
    const v = s.data[index]
    const t = v == null || Number.isNaN(v as number) ? 'no value' : formatValue(v as number)
    return `${s.name} ${t}`
  })
  return `${label}. ${parts.join('; ')}`
}

export function defaultScatterLabel(series: ScatterSeries[]): string {
  const n = series.reduce((a, s) => a + s.points.length, 0)
  if (n === 0) return 'Empty scatter chart'
  const names = series.map(s => s.name).filter(Boolean)
  return names.length ? `Scatter chart: ${names.join(', ')}` : `Scatter chart, ${n} points`
}

export function defaultHistogramLabel(binCount: number): string {
  return binCount <= 0 ? 'Empty histogram' : `Histogram, ${binCount} bins`
}

export function defaultCandleChartLabel(barCount: number): string {
  return barCount <= 0 ? 'Empty candlestick chart' : `Candlestick chart, ${barCount} bars`
}

export function candleBarSummary(bar: CandleBar, timeLabel: string): string {
  const vol = bar.v != null ? `, volume ${formatValue(bar.v)}` : ''
  return `${timeLabel}. Open ${formatValue(bar.o)}, high ${formatValue(bar.h)}, low ${formatValue(bar.l)}, close ${formatValue(bar.c)}${vol}`
}

export function zoomKeyboardHint(zoomable: boolean): string {
  if (!zoomable) return ''
  return ' Zoom: Ctrl or Meta plus mouse wheel. Shift drag to pan. Double-click to reset. Drag on the plot to zoom a range.'
}
