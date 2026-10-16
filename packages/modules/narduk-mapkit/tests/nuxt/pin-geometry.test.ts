// @vitest-environment happy-dom
/**
 * Per-pin anchor geometry (narduk-libs#422 §c.3, narduk-libs#305, #1908).
 *
 * 2.0.x had one global `annotationSize` and a hard-coded `anchorOffset` of
 * `(0, -6)`, so a consumer whose pin was not 100x56 got a marker displaced by
 * the difference. 2.1.0 replaced it with a model in which MapKit puts the
 * element's top-left at `projected + anchorOffset`; the fake agreed with it, so
 * every test passed while real MapKit JS (measured on 6.0.128 and 6.1.182)
 * centres the element on the coordinate with its bottom edge on it and moves it
 * by the NEGATIVE of the offset (narduk-libs#1908).
 *
 * These tests state the contract as a placement, not as numbers: whatever the
 * library hands MapKit, the anchor point of the pin must land on the coordinate.
 */
import { describe, expect, it } from 'vitest'

import { createFakeMapKit } from '../../src/testing/index.js'
import {
  DEFAULT_MAPKIT_PIN_ANCHOR,
  expandMapKitHitArea,
  mapKitAnchorOffset,
  mapKitAnchorPoint,
  mapKitCalloutAnchorOffset,
  mapKitCoordinateWithinPin,
  mapKitPinGeometrySignature,
} from '../../src/nuxt/runtime/pin-geometry.js'
import type { MapKitPinGeometry } from '../../src/nuxt/runtime/pin-geometry.js'

const VIEWPORT = { height: 600, width: 800 }
const CENTRE = { x: 400, y: 300 }

/** Place a pin on a fake map centred on its coordinate and report where it ended up. */
function placed(geometry: MapKitPinGeometry): { left: number; top: number } {
  const fake = createFakeMapKit({ viewport: VIEWPORT })
  fake.mapkit.init({ authorizationCallback: (done) => done('test-token') })
  const host = document.createElement('div')
  document.body.append(host)
  const map = new fake.mapkit.Map(host)
  map.region = new fake.mapkit.CoordinateRegion(
    { latitude: 0, longitude: 0 },
    { latitudeDelta: 2, longitudeDelta: 2 },
  )
  const offset = mapKitAnchorOffset(geometry)
  const annotation = new fake.mapkit.Annotation(
    { latitude: 0, longitude: 0 },
    () => document.createElement('div'),
    {
      anchorOffset: new DOMPoint(offset.x, offset.y),
      ...(geometry.size ? { size: geometry.size } : {}),
    },
  )
  map.addAnnotation(annotation)
  return {
    left: Number.parseFloat(annotation.element.style.left),
    top: Number.parseFloat(annotation.element.style.top),
  }
}

describe('mapKitAnchorOffset (§c.3, #1908)', () => {
  it('leaves a bottom-centre pin at MapKit default (0, 0), whatever its size', () => {
    expect(mapKitAnchorOffset({ size: { height: 150, width: 170 } })).toStrictEqual({ x: 0, y: 0 })
    expect(mapKitAnchorOffset({ size: { height: 16, width: 16 } })).toStrictEqual({ x: 0, y: 0 })
  })

  it('moves the pin so its centre, top-centre or top-left sits on the coordinate', () => {
    expect(mapKitAnchorOffset({ anchor: 'center', size: { height: 16, width: 16 } })).toStrictEqual(
      { x: 0, y: -8 },
    )
    expect(
      mapKitAnchorOffset({ anchor: 'top-center', size: { height: 150, width: 170 } }),
    ).toStrictEqual({ x: 0, y: -150 })
    expect(
      mapKitAnchorOffset({ anchor: 'top-left', size: { height: 150, width: 170 } }),
    ).toStrictEqual({ x: -85, y: -150 })
  })

  it('accepts an explicit anchor point, for a pin whose tip is not a named point', () => {
    // A 200x30 pill whose dot (centre 15, 15) marks the place.
    expect(
      mapKitAnchorOffset({ anchor: { x: 15, y: 15 }, size: { height: 30, width: 200 } }),
    ).toStrictEqual({ x: -85, y: -15 })
  })

  it('shifts the pin by the app offset in the documented direction (+x right, +y down)', () => {
    // Lift a 100x56 bottom-centre pin 6 px: the element moves up, which MapKit
    // expresses as a POSITIVE y offset.
    expect(
      mapKitAnchorOffset({ anchorOffset: { x: 4, y: -6 }, size: { height: 56, width: 100 } }),
    ).toStrictEqual({ x: -4, y: 6 })
  })

  it('never invents the retired (0, -6) when there is no size to anchor against', () => {
    expect(mapKitAnchorOffset({})).toStrictEqual({ x: 0, y: 0 })
    expect(mapKitAnchorOffset({ anchor: 'center' })).toStrictEqual({ x: 0, y: 0 })
    expect(mapKitAnchorOffset({ anchorOffset: { x: 0, y: -6 } })).toStrictEqual({ x: 0, y: -6 })
  })

  it('defaults to bottom-center', () => {
    expect(DEFAULT_MAPKIT_PIN_ANCHOR).toBe('bottom-center')
    expect(mapKitAnchorPoint('bottom-center', { height: 150, width: 170 })).toStrictEqual({
      x: 85,
      y: 150,
    })
  })
})

describe('the anchor point lands on the coordinate (#1908)', () => {
  const geometries: Array<[string, MapKitPinGeometry]> = [
    ['bottom-center', { size: { height: 150, width: 170 } }],
    ['center', { anchor: 'center', size: { height: 16, width: 16 } }],
    ['top-center', { anchor: 'top-center', size: { height: 40, width: 120 } }],
    ['top-left', { anchor: 'top-left', size: { height: 40, width: 120 } }],
    ['explicit point', { anchor: { x: 15, y: 15 }, size: { height: 30, width: 200 } }],
    [
      'center with an app offset',
      { anchor: 'center', anchorOffset: { x: 7, y: -3 }, size: { height: 20, width: 20 } },
    ],
  ]

  it.each(geometries)('%s', (_name, geometry) => {
    const { left, top } = placed(geometry)
    const within = mapKitCoordinateWithinPin(geometry)
    // The coordinate, found from the element's top-left, is the viewport centre.
    expect(left + within.x).toBeCloseTo(CENTRE.x, 6)
    expect(top + within.y).toBeCloseTo(CENTRE.y, 6)
    // And the point of the element on it is the anchor, moved by the app offset.
    const anchor = mapKitAnchorPoint(
      geometry.anchor ?? DEFAULT_MAPKIT_PIN_ANCHOR,
      geometry.size as { height: number; width: number },
    )
    const app = geometry.anchorOffset ?? { x: 0, y: 0 }
    expect(CENTRE.x - left).toBeCloseTo(anchor.x - app.x, 6)
    expect(CENTRE.y - top).toBeCloseTo(anchor.y - app.y, 6)
  })

  it('puts a centred wave-style dot on its stop (the transit app measured 8 px off)', () => {
    // narduk-enterprises/wave-transit-concept worked around a 16 px dot landing
    // 8 px east of its stop with `anchor: 'center'`.
    const { left, top } = placed({ anchor: 'center', size: { height: 16, width: 16 } })
    expect(left + 8).toBeCloseTo(CENTRE.x, 6)
    expect(top + 8).toBeCloseTo(CENTRE.y, 6)
  })
})

describe('mapKitCalloutAnchorOffset (#1908)', () => {
  it('points at the top-centre of the pin for every anchor', () => {
    const size = { height: 40, width: 120 }
    expect(mapKitCalloutAnchorOffset({ size })).toStrictEqual({ x: 0, y: -40 })
    expect(mapKitCalloutAnchorOffset({ anchor: 'center', size })).toStrictEqual({ x: 0, y: -20 })
    expect(mapKitCalloutAnchorOffset({ anchor: 'top-center', size })).toStrictEqual({ x: 0, y: 0 })
  })

  it('is half a pin width east of the coordinate for a top-left pin, not 225 px east', () => {
    // The 2.22.x formula was `mapKitAnchorOffset + (width / 2, 0)`; for a wide
    // top-left pill that landed the callout up to ~225 px east of the pin.
    const size = { height: 30, width: 240 }
    expect(mapKitCalloutAnchorOffset({ anchor: 'top-left', size })).toStrictEqual({ x: 120, y: 0 })
  })

  it('follows an explicit anchor point and the app offset', () => {
    // A 200x30 pill anchored on its left dot: the top-centre is 85 px east of it.
    expect(
      mapKitCalloutAnchorOffset({ anchor: { x: 15, y: 15 }, size: { height: 30, width: 200 } }),
    ).toStrictEqual({ x: 85, y: -15 })
    // The pin moved 4 px right and 2 px down carries its callout with it.
    expect(
      mapKitCalloutAnchorOffset({
        anchorOffset: { x: 4, y: 2 },
        size: { height: 40, width: 120 },
      }),
    ).toStrictEqual({ x: 4, y: -38 })
  })

  it('keeps the old no-size answer', () => {
    expect(mapKitCalloutAnchorOffset({})).toStrictEqual({ x: 0, y: 0 })
    expect(mapKitCalloutAnchorOffset({ anchorOffset: { x: 0, y: -6 } })).toStrictEqual({
      x: 0,
      y: -6,
    })
  })
})

describe('mapKitPinGeometrySignature', () => {
  it('is equal for equal geometry, so an unchanged pin never repaints', () => {
    const geometry = { anchor: 'center' as const, size: { height: 16, width: 16 } }
    expect(mapKitPinGeometrySignature(geometry)).toBe(
      mapKitPinGeometrySignature({ anchor: 'center', size: { height: 16, width: 16 } }),
    )
    expect(mapKitPinGeometrySignature({ size: { height: 16, width: 16 } })).not.toBe(
      mapKitPinGeometrySignature(geometry),
    )
  })

  it('separates a size change from an offset change', () => {
    expect(mapKitPinGeometrySignature({ size: { height: 150, width: 170 } })).not.toBe(
      mapKitPinGeometrySignature({ size: { height: 150, width: 171 } }),
    )
    expect(mapKitPinGeometrySignature({ anchorOffset: { x: 0, y: 0 } })).not.toBe(
      mapKitPinGeometrySignature({ anchorOffset: { x: 0, y: -6 } }),
    )
  })

  it('distinguishes explicit anchor points', () => {
    expect(mapKitPinGeometrySignature({ anchor: { x: 1, y: 2 } })).not.toBe(
      mapKitPinGeometrySignature({ anchor: { x: 2, y: 1 } }),
    )
  })
})

describe('expandMapKitHitArea', () => {
  it('grows a small dot to 44 px and keeps it centred on the coordinate', () => {
    const geometry: MapKitPinGeometry = { anchor: 'center', size: { height: 16, width: 16 } }

    const { geometry: grown, padding } = expandMapKitHitArea(geometry)

    expect(grown.size).toStrictEqual({ height: 44, width: 44 })
    expect(padding).toStrictEqual({ bottom: 14, left: 14, right: 14, top: 14 })
    const { left, top } = placed(grown)
    expect(left + padding.left + 8).toBeCloseTo(CENTRE.x, 6)
    expect(top + padding.top + 8).toBeCloseTo(CENTRE.y, 6)
  })

  it('grows a bottom-centre pin upward so its tip stays on the coordinate', () => {
    const geometry: MapKitPinGeometry = { size: { height: 30, width: 20 } }

    const { geometry: grown, padding } = expandMapKitHitArea(geometry)

    expect(padding).toStrictEqual({ bottom: 0, left: 12, right: 12, top: 14 })
    expect(grown.anchor).toBe('bottom-center')
    const { left, top } = placed(grown)
    // The glyph's bottom-centre is (left + 12 + 10, top + 14 + 30).
    expect(left + 22).toBeCloseTo(CENTRE.x, 6)
    expect(top + 44).toBeCloseTo(CENTRE.y, 6)
  })

  it('grows a top-left pin down and right, moving the anchor onto the glyph corner', () => {
    const geometry: MapKitPinGeometry = { anchor: 'top-left', size: { height: 20, width: 30 } }

    const { geometry: grown, padding } = expandMapKitHitArea(geometry)

    expect(padding).toStrictEqual({ bottom: 24, left: 7, right: 7, top: 0 })
    expect(grown.anchor).toStrictEqual({ x: 7, y: 0 })
    const { left, top } = placed(grown)
    expect(left + 7).toBeCloseTo(CENTRE.x, 6)
    expect(top).toBeCloseTo(CENTRE.y, 6)
  })

  it('carries an explicit anchor point and the app offset through', () => {
    const geometry: MapKitPinGeometry = {
      anchor: { x: 5, y: 6 },
      anchorOffset: { x: 3, y: -2 },
      size: { height: 12, width: 40 },
    }

    const { geometry: grown, padding } = expandMapKitHitArea(geometry, 44)

    expect(grown.anchor).toStrictEqual({ x: 5 + padding.left, y: 6 + padding.top })
    expect(grown.anchorOffset).toStrictEqual({ x: 3, y: -2 })
    expect(grown.size).toStrictEqual({ height: 44, width: 44 })
  })

  it('returns a geometry that is already large enough, or has no size, as it was', () => {
    const big: MapKitPinGeometry = { size: { height: 60, width: 50 } }
    const unsized: MapKitPinGeometry = { anchor: 'center' }

    expect(expandMapKitHitArea(big).geometry).toBe(big)
    expect(expandMapKitHitArea(unsized).geometry).toBe(unsized)
    expect(expandMapKitHitArea(big).padding).toStrictEqual({ bottom: 0, left: 0, right: 0, top: 0 })
    expect(expandMapKitHitArea({ size: { height: 8, width: 8 } }, 0).geometry.size).toStrictEqual({
      height: 8,
      width: 8,
    })
  })

  it('only grows the dimension that is short', () => {
    const { geometry, padding } = expandMapKitHitArea({
      anchor: 'center',
      size: { height: 20, width: 120 },
    })

    expect(geometry.size).toStrictEqual({ height: 44, width: 120 })
    expect(padding).toStrictEqual({ bottom: 12, left: 0, right: 0, top: 12 })
  })
})
