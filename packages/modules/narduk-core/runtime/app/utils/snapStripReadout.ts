/**
 * Position readout for `AppSnapStrip` (`1–2 of 6`).
 *
 * The en dash is part of the contract (narduk-libs#529): a hyphenated
 * `1-2 of 6` is a bug, not a locale spelling.
 */

/** En dash used between the first and last visible item. */
export const SNAP_STRIP_EN_DASH = '\u2013'

export function formatSnapStripReadout(first: number, last: number, total: number): string {
  if (total <= 0) return '0 of 0'

  const start = Math.min(Math.max(1, first), total)
  const end = Math.min(Math.max(start, last), total)
  if (start === end) return `${start} of ${total}`
  return `${start}${SNAP_STRIP_EN_DASH}${end} of ${total}`
}

/**
 * First-page estimate used on the server and before IntersectionObserver
 * reports visibility. `itemsPerView` defaults to 2 (the phone reading).
 */
export function initialSnapStripRange(
  total: number,
  itemsPerView = 2,
): { first: number; last: number } {
  if (total <= 0) return { first: 0, last: 0 }
  const perView = Math.max(1, itemsPerView)
  return { first: 1, last: Math.min(perView, total) }
}
