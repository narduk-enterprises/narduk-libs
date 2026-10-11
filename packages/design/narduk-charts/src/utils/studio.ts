import { layoutReferenceLabelYs } from './refLabelLayout'

/*
 * Pure helpers behind the studio look's right-hand gutter (now tags, end labels,
 * level labels). Text is never measured: widths come from character counts so
 * the server and the browser lay the gutter out identically and a hydrated chart
 * cannot shift.
 */

/** Height of a now-tag chip, in px. */
export const STUDIO_TAG_HEIGHT = 18

/** Gap between the plot's right edge and the first gutter element, in px. */
export const STUDIO_GUTTER_GAP = 8

/** Width of the coloured key mark inside a tag, and of a stand-alone one beside an end label. */
export const STUDIO_KEY_WIDTH = 3

/** Estimated width of `text` at `fontPx`: 0.6em per character, the width of a tabular digit. */
export function estimateTextPx(text: string, fontPx: number): number {
  return Math.ceil(text.length * fontPx * 0.6)
}

/** Width of a now tag for `text`: padding, key mark, 11px value, padding. */
export function nowTagWidth(text: string): number {
  return 5 + STUDIO_KEY_WIDTH + 4 + estimateTextPx(text, 11) + 6
}

/** Width of a stand-alone end label (key mark + name) for a series with no tag. */
export function endLabelOnlyWidth(name: string): number {
  return STUDIO_KEY_WIDTH + 5 + estimateTextPx(name, 11)
}

export interface GutterRowInput {
  id: number
  /** Y of the value the row belongs to. */
  y: number
}

/**
 * Stack gutter rows so none overlap, as close to their own Y as possible and
 * inside `bounds`. Returns Y per id.
 */
export function layoutGutterRows(
  rows: readonly GutterRowInput[],
  bounds: { top: number; bottom: number },
): Map<number, number> {
  return layoutReferenceLabelYs(
    rows.map(r => ({ id: r.id, lineY: r.y })),
    bounds,
    { labelHeight: STUDIO_TAG_HEIGHT, gap: 2 },
  )
}

/** True when stacking moved any row more than `tolerance` px from its own Y. */
export function rowsWereMoved(
  rows: readonly GutterRowInput[],
  laidOut: ReadonlyMap<number, number>,
  tolerance = 2,
): boolean {
  return rows.some(r => Math.abs((laidOut.get(r.id) ?? r.y) - r.y) > tolerance)
}

/** Height a level label needs, and so the shortest band that gets one. */
export const STUDIO_BAND_LABEL_MIN_HEIGHT = 14

/** Gap kept between a level label and a tag box, so the two never touch. */
const STUDIO_LABEL_TAG_GAP = 3

/**
 * Where a `yBands` label sits in the gutter. Every `occupied` Y is the centre
 * of a now-tag box ({@link STUDIO_TAG_HEIGHT} tall); the label's own box must
 * stay clear of each one by {@link STUDIO_LABEL_TAG_GAP}. Tries the band's
 * centre, then its top and bottom edge, then a nudge to just above or below
 * each tag, as long as the label still fits inside the band. `null` (leave the
 * label out) when the band is shorter than {@link STUDIO_BAND_LABEL_MIN_HEIGHT}
 * or no spot clears.
 */
export function placeBandLabel(
  band: { top: number; bottom: number },
  occupied: readonly number[],
): number | null {
  const height = band.bottom - band.top
  if (height < STUDIO_BAND_LABEL_MIN_HEIGHT) return null
  const half = STUDIO_BAND_LABEL_MIN_HEIGHT / 2
  const clearance = STUDIO_TAG_HEIGHT / 2 + half + STUDIO_LABEL_TAG_GAP
  const lo = band.top + half
  const hi = band.bottom - half
  const nudges = occupied.flatMap(o => [o - clearance, o + clearance])
  const candidates = [(band.top + band.bottom) / 2, lo, hi, ...nudges].filter(
    y => y >= lo && y <= hi,
  )
  for (const y of candidates) {
    if (occupied.every(o => Math.abs(o - y) >= clearance - 0.01)) return y
  }
  return null
}
