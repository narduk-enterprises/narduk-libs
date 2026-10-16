/**
 * Per-pin anchor geometry (narduk-libs#305, spec §c.3; corrected in narduk-libs#1908).
 *
 * ## The defect this replaces
 *
 * 2.0.x gave every annotation one global `annotationSize` (default 100x56) and
 * a hard-coded `anchorOffset` of `(0, -6)`. A consumer whose pin is not 100x56
 * -- Buoys' 170x150 station card, for instance -- got a marker displaced by the
 * difference. There was no way to fix it from the app, because the app cannot
 * know what MapKit will do with the offset.
 *
 * ## What MapKit's `anchorOffset` actually means
 *
 * 2.1.0 modelled it as "the element's top-left lands on `projected + offset`".
 * That is not what MapKit JS does, and the fake at `./testing` repeated the
 * same mistake, so every test agreed with it. Measured on the live library
 * (`mapkit.convertCoordinateToPointOnPage` against the element's bounding box,
 * MapKit JS 6.0.128 and 6.1.182, identical on both):
 *
 * 1. With `anchorOffset (0, 0)` the element is centred horizontally on the
 *    coordinate with its **bottom edge** on it.
 * 2. A non-zero offset then moves the element by the **negative** of the
 *    offset: `(10, 0)` moves it 10 px left, `(0, -10)` moves it 10 px down.
 *
 * So the point of the element that sits on the coordinate is
 * `(width / 2 + offset.x, height + offset.y)`, in CSS px from its top-left.
 * `<AppMapKit>` therefore asks the question an app can answer -- *which point
 * of my pin sits on the coordinate?* -- and solves for MapKit's offset:
 *
 * ```text
 * mapKitOffset = anchorPoint - (width / 2, height) - appOffset
 * ```
 *
 * A 170x150 pin anchored `bottom-center` gets `(0, 0)`, MapKit's own default;
 * anchored `center` it gets `(0, -75)`; a 16x16 `center` dot gets `(0, -8)`.
 * `tests/testing/fake-mapkit.test.ts` pins the fake to the measured behaviour,
 * so these numbers are checked against a projection that places elements the
 * way MapKit does.
 */

/** A named point of the pin element, or an explicit one in CSS px from its top-left. */
export type MapKitPinAnchor =
  'bottom-center' | 'center' | 'top-center' | 'top-left' | { x: number; y: number }

export interface MapKitPinGeometry {
  /**
   * CSS px the pin is moved AFTER the anchor is applied (`+x` right, `+y`
   * down), so `{ x: 0, y: -4 }` lifts it 4 px. Default `{ x: 0, y: 0 }`.
   *
   * With no `size` there is nothing to solve against and this is handed to
   * MapKit untouched, in MapKit's own convention (the element moves by the
   * NEGATIVE of it).
   */
  anchorOffset?: { x: number; y: number }
  /**
   * Which point of the element sits on the coordinate. Default `'bottom-center'`.
   * A `{ x, y }` is a point in CSS px from the element's top-left, for a pin
   * whose tip is not one of the four named points (a pill whose dot, not its
   * middle, marks the place).
   */
  anchor?: MapKitPinAnchor
  /**
   * Element box in CSS px. Omitted means "MapKit measures the rendered glyph",
   * which is correct for a glyph whose size MapKit can read but gives MapKit no
   * anchor to compute -- so an omitted size keeps MapKit's own default
   * (bottom-centre on the coordinate) and the offset at the app-supplied value
   * alone.
   */
  size?: { height: number; width: number }
}

export const DEFAULT_MAPKIT_PIN_ANCHOR: MapKitPinAnchor = 'bottom-center'

export interface MapKitPoint2D {
  x: number
  y: number
}

/** The element-local point that lands on the coordinate, in CSS px from its top-left. */
export function mapKitAnchorPoint(
  anchor: MapKitPinAnchor,
  size: { height: number; width: number },
): MapKitPoint2D {
  if (typeof anchor === 'object') return { x: anchor.x, y: anchor.y }
  if (anchor === 'top-left') return { x: 0, y: 0 }
  if (anchor === 'top-center') return { x: size.width / 2, y: 0 }
  if (anchor === 'center') return { x: size.width / 2, y: size.height / 2 }
  return { x: size.width / 2, y: size.height }
}

/**
 * MapKit's own `anchorOffset` for one pin.
 *
 * MapKit puts the point `(width / 2 + offset.x, height + offset.y)` of the
 * element on the coordinate (see the file comment), so the offset that puts
 * `anchorPoint - appOffset` there is `anchorPoint - (width / 2, height) -
 * appOffset`. `bottom-center` with no app offset is `(0, 0)`.
 *
 * With no `size` there is nothing to anchor against, so only the app's explicit
 * `anchorOffset` survives -- never the 2.0.x `(0, -6)`, which is the defect.
 */
export function mapKitAnchorOffset(geometry: MapKitPinGeometry): MapKitPoint2D {
  const offset = geometry.anchorOffset ?? { x: 0, y: 0 }
  const size = geometry.size
  if (!size) return { x: offset.x, y: offset.y }
  const anchor = mapKitAnchorPoint(geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR, size)
  return { x: anchor.x - size.width / 2 - offset.x, y: anchor.y - size.height - offset.y }
}

/**
 * Where the pin's top-centre is, relative to the coordinate, in CSS px: the
 * point a callout should point at. `(0, -height)` for a `bottom-center` pin,
 * `(0, -height / 2)` for a `center` one, wherever the anchor and offset put it.
 *
 * Without a `size` the pin's height is unknown here, so this answers `(0, 0)`
 * plus the app's own offset in MapKit's convention -- the same as 2.1.x.
 */
export function mapKitCalloutAnchorOffset(geometry: MapKitPinGeometry): MapKitPoint2D {
  const offset = geometry.anchorOffset ?? { x: 0, y: 0 }
  const size = geometry.size
  if (!size) return { x: offset.x, y: offset.y }
  const anchor = mapKitAnchorPoint(geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR, size)
  return { x: size.width / 2 - anchor.x + offset.x, y: -anchor.y + offset.y }
}

/**
 * Offset from the element's top-left corner to the coordinate it is anchored
 * on, in CSS px. The inverse of the placement, for a caller that can read the
 * element's position (its `offsetLeft` / `offsetTop`) but cannot project.
 * `measured` stands in for a geometry with no `size`.
 */
export function mapKitCoordinateWithinPin(
  geometry: MapKitPinGeometry,
  measured: { height: number; width: number } = { height: 0, width: 0 },
): MapKitPoint2D {
  const offset = geometry.anchorOffset ?? { x: 0, y: 0 }
  const size = geometry.size
  if (!size) return { x: measured.width / 2 + offset.x, y: measured.height + offset.y }
  const anchor = mapKitAnchorPoint(geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR, size)
  return { x: anchor.x - offset.x, y: anchor.y - offset.y }
}

/** Stable string for a geometry, so an unchanged one never repaints a pin. */
export function mapKitPinGeometrySignature(geometry: MapKitPinGeometry): string {
  const offset = geometry.anchorOffset ?? { x: 0, y: 0 }
  const size = geometry.size
  const anchor = geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR
  return [
    typeof anchor === 'object' ? `${String(anchor.x)}:${String(anchor.y)}` : anchor,
    size ? `${String(size.width)}x${String(size.height)}` : '-',
    `${String(offset.x)},${String(offset.y)}`,
  ].join('|')
}

/**
 * WCAG 2.5.8 (target size, minimum) asks for 24 CSS px; the platform guidance
 * (Apple HIG, Material) and WCAG 2.5.5 (enhanced) ask for 44. A map dot is
 * usually 8 to 16 px, so the touch target must be bigger than the glyph.
 */
export const MAPKIT_MIN_HIT_TARGET = 44

/** CSS px of transparent hit area around the visual glyph, per side. */
export interface MapKitHitAreaPadding {
  bottom: number
  left: number
  right: number
  top: number
}

export interface MapKitHitArea {
  /** The geometry of the enlarged host: hand this to MapKit instead of the visual one. */
  geometry: MapKitPinGeometry
  /** Padding that keeps the visual glyph where `anchor` says it is inside the larger host. */
  padding: MapKitHitAreaPadding
}

const NO_PADDING: MapKitHitAreaPadding = { bottom: 0, left: 0, right: 0, top: 0 }

/**
 * Grow a pin's host to at least `minTarget` x `minTarget` CSS px while its
 * visual glyph stays exactly where it was.
 *
 * The host is the interactive element (`role="button"`, the click target), so
 * enlarging it enlarges the tap target without touching the glyph. The visual
 * is centred horizontally. Vertically it keeps the edge its anchor names, so a
 * `bottom-center` pin keeps its tip on the coordinate and grows its hit area
 * upward, a `top-center`/`top-left` pin grows downward, and a `center` pin grows
 * both ways. The returned geometry moves the anchor by the padding, so the
 * coordinate stays on the same point of the glyph.
 *
 * A geometry with no `size` cannot be enlarged (its box is unknown) and is
 * returned as is, with no padding.
 */
export function expandMapKitHitArea(
  geometry: MapKitPinGeometry,
  minTarget: number = MAPKIT_MIN_HIT_TARGET,
): MapKitHitArea {
  const size = geometry.size
  if (!size || minTarget <= 0) return { geometry, padding: NO_PADDING }
  const width = Math.max(size.width, minTarget)
  const height = Math.max(size.height, minTarget)
  if (width === size.width && height === size.height) return { geometry, padding: NO_PADDING }

  const anchor = geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR
  const extraX = (width - size.width) / 2
  const extraY = height - size.height
  const verticalShare =
    anchor === 'bottom-center' ? 1 : anchor === 'top-center' || anchor === 'top-left' ? 0 : 0.5
  const padding: MapKitHitAreaPadding = {
    bottom: extraY * (1 - verticalShare),
    left: extraX,
    right: extraX,
    top: extraY * verticalShare,
  }

  const visualAnchor = mapKitAnchorPoint(anchor, size)
  const enlarged: MapKitPinGeometry = {
    ...geometry,
    anchor:
      typeof anchor === 'string' && anchor !== 'top-left'
        ? anchor
        : { x: visualAnchor.x + padding.left, y: visualAnchor.y + padding.top },
    size: { height, width },
  }
  return { geometry: enlarged, padding }
}
