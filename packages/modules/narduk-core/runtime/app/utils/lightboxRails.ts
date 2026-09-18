/**
 * Thumbnail-rail helpers for `AppLightbox` (narduk-libs#529).
 *
 * At most two rails render. Rail 1 owns the horizontal arrow axis; rail 2
 * owns the vertical axis. With no rails the lightbox keeps its existing
 * left/right gallery navigation.
 */

export const LIGHTBOX_MAX_RAILS = 2

export interface LightboxRailSelectPayload {
  itemIndex: number
  railIndex: number
}

export function visibleLightboxRails<T>(rails: readonly T[] | undefined | null): T[] {
  return (rails ?? []).slice(0, LIGHTBOX_MAX_RAILS)
}

/** Which rail a key moves when rails are present, or `null` if it does not. */
export function railIndexForKey(key: string, railCount: number): number | null {
  if (railCount > 0 && (key === 'ArrowLeft' || key === 'ArrowRight')) return 0
  if (railCount > 1 && (key === 'ArrowUp' || key === 'ArrowDown')) return 1
  return null
}

export function railStepForKey(key: string): number {
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1
  return 0
}

export function nextRailItemIndex(current: number, step: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(length - 1, Math.max(0, current + step))
}
