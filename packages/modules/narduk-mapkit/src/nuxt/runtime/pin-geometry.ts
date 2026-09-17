/**
 * Per-pin anchor geometry (narduk-libs#305, spec §c.3).
 *
 * ## The defect this replaces
 *
 * 2.0.x gave every annotation one global `annotationSize` (default 100x56) and
 * a hard-coded `anchorOffset` of `(0, -6)`. A consumer whose pin is not 100x56
 * -- Buoys' 170x150 station card, for instance -- got a marker displaced by the
 * difference, measured at -85 / -144 px. There was no way to fix it from the
 * app, because the app cannot know what MapKit will do with the offset.
 *
 * ## The model
 *
 * MapKit places the annotation element's **top-left corner** at
 * `projectedPoint + anchorOffset`. That is an awkward thing for an application
 * to reason about, so `<AppMapKit>` takes the question the app actually has an
 * answer to -- *which point of my pin sits on the coordinate?* -- and computes
 * MapKit's offset from it:
 *
 * ```text
 * anchorOffset = -(anchor point within the element) + anchorOffset the app asked for
 * ```
 *
 * A 170x150 pin anchored `bottom-center` therefore gets `(-85, -150)`, which is
 * exactly what `tests/testing/fake-mapkit.test.ts` pins against the fake's
 * projection. `size` is per pin, so a 170x150 card and a 16x16 dot are both
 * correct on the same map.
 */

/** Which point of the pin element sits on the coordinate. */
export type MapKitPinAnchor = 'bottom-center' | 'center' | 'top-center' | 'top-left'

export interface MapKitPinGeometry {
  /**
   * CSS px added AFTER the anchor is applied (`+x` right, `+y` down).
   * Default `{ x: 0, y: 0 }`.
   */
  anchorOffset?: { x: number; y: number }
  /** Which point of the element sits on the coordinate. Default `'bottom-center'`. */
  anchor?: MapKitPinAnchor
  /**
   * Element box in CSS px. Omitted means "MapKit measures the rendered glyph",
   * which is correct for a glyph whose size MapKit can read but gives MapKit no
   * anchor to compute -- so an omitted size with a non-`top-left` anchor keeps
   * the offset at the app-supplied value alone.
   */
  size?: { height: number; width: number }
}

export const DEFAULT_MAPKIT_PIN_ANCHOR: MapKitPinAnchor = 'bottom-center'

/** The element-local point that lands on the coordinate, in CSS px from its top-left. */
export function mapKitAnchorPoint(
  anchor: MapKitPinAnchor,
  size: { height: number; width: number },
): { x: number; y: number } {
  if (anchor === 'top-left') return { x: 0, y: 0 }
  if (anchor === 'top-center') return { x: size.width / 2, y: 0 }
  if (anchor === 'center') return { x: size.width / 2, y: size.height / 2 }
  return { x: size.width / 2, y: size.height }
}

/**
 * MapKit's own `anchorOffset` for one pin.
 *
 * With no `size` there is nothing to anchor against, so only the app's explicit
 * `anchorOffset` survives -- never the 2.0.x `(0, -6)`, which is the defect.
 */
export function mapKitAnchorOffset(geometry: MapKitPinGeometry): { x: number; y: number } {
  const offset = geometry.anchorOffset ?? { x: 0, y: 0 }
  const size = geometry.size
  if (!size) return { x: offset.x, y: offset.y }
  const anchor = mapKitAnchorPoint(geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR, size)
  return { x: offset.x - anchor.x, y: offset.y - anchor.y }
}

/** Stable string for a geometry, so an unchanged one never repaints a pin. */
export function mapKitPinGeometrySignature(geometry: MapKitPinGeometry): string {
  const offset = geometry.anchorOffset ?? { x: 0, y: 0 }
  const size = geometry.size
  return [
    geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR,
    size ? `${String(size.width)}x${String(size.height)}` : '-',
    `${String(offset.x)},${String(offset.y)}`,
  ].join('|')
}
