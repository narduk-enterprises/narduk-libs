/**
 * SVG candle charts should cap drawn buckets (`maxDrawBars`) so node count stays bounded.
 * After Phase-1 UX work, profile on target devices; if jank remains, prefer Canvas or Lightweight Charts.
 */
export function recommendMaxDrawBars(options: {
  /** Plot width in CSS px (approx. categories across the viewport). */
  plotWidthPx: number
  /** Hard ceiling per chart instance (default 768). */
  maxCap?: number
  /** Target bars per pixel (default ~1.2 buckets / 4px). */
  bucketsPerPx?: number
}): number {
  const cap = options.maxCap ?? 768
  const k = options.bucketsPerPx ?? 0.3
  const w = Math.max(120, options.plotWidthPx)
  const raw = Math.ceil(w * k)
  return Math.max(32, Math.min(cap, raw))
}

export type CandleRenderStrategy = 'svg-capped' | 'canvas' | 'lightweight-charts'

/** Documented outcome of the perf gate (call from app setup or devtools). */
export function suggestCandleRenderStrategy(barCount: number, maxDrawBars: number): CandleRenderStrategy {
  if (barCount <= maxDrawBars * 4) return 'svg-capped'
  if (barCount <= 50_000) return 'canvas'
  return 'lightweight-charts'
}
