export interface AxisLabelIndexOptions {
  i0: number
  i1: number
  plotWidth: number
  minPxPerLabel: number
  labelAt?: (index: number) => string
}

/**
 * Default time-axis labels. Locale is a fixed `en-US` and the zone defaults
 * to `UTC` — never the host's resolved locale or `TZ`.
 *
 * workerd renders charts in UTC/`en`; the browser uses the reader's zone and
 * locale. `toLocaleString(undefined, …)` without `timeZone` produces two
 * strings (and sometimes two tick sets, because {@link selectEvenAxisLabelIndices}
 * dedupes on the formatted label) and Vue's hydration check fails. Passing an
 * own `undefined` `timeZone` is the same bug: `Intl` treats it as the host
 * zone, so this helper coalesces with `|| 'UTC'` rather than a default
 * argument (which `fn(t, undefined)` would skip).
 */
export const TIME_AXIS_LOCALE = 'en-US'
export const DEFAULT_TIME_AXIS_TIME_ZONE = 'UTC'

export function resolveTimeAxisTimeZone(timeZone?: string): string {
  return timeZone || DEFAULT_TIME_AXIS_TIME_ZONE
}

export function defaultTimeAxisLabel(tMs: number, timeZone?: string): string {
  const d = new Date(tMs)
  if (Number.isNaN(d.getTime())) return String(tMs)
  return d.toLocaleString(TIME_AXIS_LOCALE, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: resolveTimeAxisTimeZone(timeZone),
  })
}

export function dedupeAdjacentAxisLabelIndices(
  indices: number[],
  labelAt: (index: number) => string,
): number[] {
  if (indices.length <= 2) return indices
  const out: number[] = [indices[0]!]
  let lastLabel = labelAt(indices[0]!)
  for (let k = 1; k < indices.length - 1; k++) {
    const index = indices[k]!
    const label = labelAt(index)
    if (label === lastLabel) continue
    out.push(index)
    lastLabel = label
  }
  const last = indices[indices.length - 1]!
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

export function selectEvenAxisLabelIndices(options: AxisLabelIndexOptions): number[] {
  const i0 = Math.max(0, Math.floor(options.i0))
  const i1 = Math.max(i0, Math.ceil(options.i1))
  const span = Math.max(1, i1 - i0 + 1)
  const minPxPerLabel = Math.max(1, options.minPxPerLabel)
  const plotWidth = Math.max(1, options.plotWidth)
  const maxSlots = Math.max(2, Math.floor(plotWidth / minPxPerLabel))
  const count = Math.min(span, maxSlots)

  if (count >= span) {
    const all = Array.from({ length: span }, (_, k) => i0 + k)
    return options.labelAt ? dedupeAdjacentAxisLabelIndices(all, options.labelAt) : all
  }

  const out: number[] = []
  for (let k = 0; k < count; k++) {
    const t = count <= 1 ? 0 : k / (count - 1)
    out.push(Math.round(i0 + t * (i1 - i0)))
  }

  let uniq = [...new Set(out)].sort((a, b) => a - b)
  if (uniq.length === 0) return [i0]
  if (uniq[0] !== i0) uniq = [i0, ...uniq]
  if (uniq[uniq.length - 1] !== i1) uniq = [...uniq, i1]

  const merged = [...new Set(uniq)].sort((a, b) => a - b)
  return options.labelAt ? dedupeAdjacentAxisLabelIndices(merged, options.labelAt) : merged
}

/** Approximate advance of one X tick glyph (10px, weight 600, 0.03em tracking), in px. */
export const X_TICK_GLYPH_PX = 6.2

/** Smallest clear space between two neighbouring X tick labels, in px. */
export const X_TICK_MIN_GAP_PX = 4

export interface ThinTickOptions {
  /** Pixel X of a tick's centre. */
  xAt: (index: number) => number
  /** Label text of a tick, used to estimate its width. */
  labelAt: (index: number) => string
  /** Estimated px per character. Default {@link X_TICK_GLYPH_PX}. */
  glyphPx?: number
  /** Clear space kept between two labels. Default {@link X_TICK_MIN_GAP_PX}. */
  gapPx?: number
}

/**
 * Drop X tick indices so no two labels overlap, whatever the font or label
 * length. The last tick always wins, then the first; every other tick keeps its
 * place only if it clears everything already kept. The input order is
 * preserved. Pure and DOM-free (widths are estimated from character count), so
 * the server and the browser keep the same ticks.
 *
 * This is the "Sep 26Oct 26" fix: the automatic spacing appended the final index
 * after a stepped run, which could land a few pixels from the previous label.
 */
export function thinOverlappingTicks(indices: number[], options: ThinTickOptions): number[] {
  if (indices.length <= 1) return indices
  const glyph = options.glyphPx ?? X_TICK_GLYPH_PX
  const gap = options.gapPx ?? X_TICK_MIN_GAP_PX
  const box = (index: number) => {
    const half = (options.labelAt(index).length * glyph) / 2
    const x = options.xAt(index)
    return { left: x - half, right: x + half }
  }
  const priority = [
    indices.length - 1,
    0,
    ...Array.from({ length: Math.max(0, indices.length - 2) }, (_, k) => indices.length - 2 - k),
  ]
  const kept = new Set<number>()
  const keptBoxes: Array<{ left: number; right: number }> = []
  for (const pos of priority) {
    if (kept.has(pos)) continue
    const b = box(indices[pos]!)
    if (keptBoxes.some(k => b.left < k.right + gap && b.right + gap > k.left)) continue
    kept.add(pos)
    keptBoxes.push(b)
  }
  return indices.filter((_, pos) => kept.has(pos))
}
