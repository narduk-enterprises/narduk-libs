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

/**
 * Where a `yBands` label sits in the gutter: the band's centre, else near its
 * top, else near its bottom, whichever clears every occupied Y by at least
 * `clearance`. `null` (leave the label out) when the band is shorter than
 * {@link STUDIO_BAND_LABEL_MIN_HEIGHT} or no spot clears.
 */
export function placeBandLabel(
  band: { top: number; bottom: number },
  occupied: readonly number[],
  clearance = 15,
): number | null {
  const height = band.bottom - band.top
  if (height < STUDIO_BAND_LABEL_MIN_HEIGHT) return null
  const inset = STUDIO_BAND_LABEL_MIN_HEIGHT / 2
  const candidates = [(band.top + band.bottom) / 2, band.top + inset, band.bottom - inset]
  for (const y of candidates) {
    if (occupied.every(o => Math.abs(o - y) >= clearance)) return y
  }
  return null
}
