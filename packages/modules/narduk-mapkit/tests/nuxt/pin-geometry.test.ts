/**
 * Per-pin anchor geometry (narduk-libs#422 §c.3, narduk-libs#305).
 *
 * 2.0.x had one global `annotationSize` and a hard-coded `anchorOffset` of
 * `(0, -6)`, so a consumer whose pin was not 100x56 got a marker displaced by
 * the difference. These are the numbers that defect produced, and the ones it
 * should have produced.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAPKIT_PIN_ANCHOR,
  mapKitAnchorOffset,
  mapKitAnchorPoint,
  mapKitPinGeometrySignature,
} from '../../src/nuxt/runtime/pin-geometry.js'

describe('mapKitAnchorOffset (§c.3)', () => {
  it('puts the bottom centre of a 170x150 pin on the coordinate', () => {
    // Buoys' station card. MapKit places the element's TOP-LEFT at
    // projectedPoint + anchorOffset, so bottom-centre is (-w/2, -h).
    expect(mapKitAnchorOffset({ size: { height: 150, width: 170 } })).toStrictEqual({
      x: -85,
      y: -150,
    })
  })

  it('sizes the anchor per pin, so a dot and a card share one map', () => {
    expect(mapKitAnchorOffset({ anchor: 'center', size: { height: 16, width: 16 } })).toStrictEqual(
      {
        x: -8,
        y: -8,
      },
    )
    expect(
      mapKitAnchorOffset({ anchor: 'top-center', size: { height: 150, width: 170 } }),
    ).toStrictEqual({ x: -85, y: 0 })
    expect(
      mapKitAnchorOffset({ anchor: 'top-left', size: { height: 150, width: 170 } }),
    ).toStrictEqual({ x: 0, y: 0 })
  })

  it('adds the app-supplied offset after the anchor', () => {
    expect(
      mapKitAnchorOffset({
        anchorOffset: { x: 4, y: -6 },
        size: { height: 56, width: 100 },
      }),
    ).toStrictEqual({ x: -46, y: -62 })
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
})
