/** How many `--color-chart-series-N` tokens the stylesheet declares. */
export const SERIES_TOKEN_COUNT = 10

/**
 * Literal values baked in as the `var()` fallback, matching the `:root` palette
 * in `styles/chart.css`. They only take effect where the stylesheet is absent —
 * a standalone `exportChartSvg` file, or an email client — so a chart degrades
 * to the default palette instead of black.
 */
export const DEFAULT_COLORS = [
  'oklch(56% 0.17 268)',
  'oklch(62% 0.13 176)',
  'oklch(74% 0.13 82)',
  'oklch(60% 0.15 322)',
  'oklch(63% 0.17 20)',
  'oklch(62% 0.12 212)',
  'oklch(56% 0.13 140)',
  'oklch(66% 0.14 50)',
  'oklch(52% 0.15 296)',
  'oklch(58% 0.12 240)',
]

/**
 * Resolve a series `index` to a paint value.
 *
 * With no `custom` palette this returns a **token reference**, not a literal, so
 * `theme="colorblind-safe"`, `theme="print"` and dark mode repaint the series
 * along with everything else. A `custom` palette still wins outright — a
 * consumer passing explicit colors means them literally.
 */
export function getColor(custom: string[] | undefined, index: number): string {
  if (custom?.length) return custom[index % custom.length]
  const slot = ((index % SERIES_TOKEN_COUNT) + SERIES_TOKEN_COUNT) % SERIES_TOKEN_COUNT
  return `var(--color-chart-series-${slot + 1}, ${DEFAULT_COLORS[slot]})`
}
