/**
 * Framing arithmetic (§c.6 `zoomToFit`, §c.1 `preserveRegion`).
 */
import { describe, expect, it } from 'vitest'

import { mapKitBoundingRegion, mapKitGeometryPoints } from '../../src/nuxt/runtime/region.js'

describe('mapKitBoundingRegion', () => {
  it('centres on the points and pads the span', () => {
    const region = mapKitBoundingRegion([
      { lat: 30, lng: -88 },
      { lat: 31, lng: -87 },
    ])

    expect(region?.center).toStrictEqual({ lat: 30.5, lng: -87.5 })
    expect(region?.span.lat).toBeCloseTo(1.05, 10)
    expect(region?.span.lng).toBeCloseTo(1.05, 10)
  })

  it('keeps a floor so a single point still shows context', () => {
    const region = mapKitBoundingRegion([{ lat: 30, lng: -88 }])

    expect(region?.center).toStrictEqual({ lat: 30, lng: -88 })
    expect(region?.span).toStrictEqual({ lat: 0.005, lng: 0.006 })
  })

  it('honours an app-supplied minimum span', () => {
    const region = mapKitBoundingRegion([{ lat: 30, lng: -88 }], { minSpanDelta: 0.5 })

    expect(region?.span).toStrictEqual({ lat: 0.5, lng: 0.5 })
  })

  it('ignores non-finite points instead of producing a NaN region', () => {
    const region = mapKitBoundingRegion([
      { lat: Number.NaN, lng: -88 },
      { lat: 30, lng: -88 },
      { lat: 31, lng: Number.POSITIVE_INFINITY },
    ])

    expect(region?.center).toStrictEqual({ lat: 30, lng: -88 })
  })

  describe('points either side of the antimeridian (#868)', () => {
    it('frames the narrow strip across 180, not the 359-degree arc through 0', () => {
      const region = mapKitBoundingRegion([
        { lat: 30, lng: 179.5 },
        { lat: 31, lng: -179.5 },
      ])

      expect(Math.abs(region!.center.lng)).toBeCloseTo(180, 10)
      expect(region?.center.lat).toBe(30.5)
      expect(region?.span.lng).toBeCloseTo(1.05, 10)
    })

    it('frames a Pacific route that crosses the line', () => {
      const region = mapKitBoundingRegion([
        { lat: 21, lng: 170 },
        { lat: 21, lng: 178 },
        { lat: 21, lng: -175 },
        { lat: 21, lng: -170 },
      ])

      expect(Math.abs(region!.center.lng)).toBeCloseTo(180, 10)
      expect(region?.span.lng).toBeCloseTo(20 * 1.05, 10)
    })

    it('still takes the direct span when the points straddle the prime meridian', () => {
      const region = mapKitBoundingRegion([
        { lat: 51, lng: -1 },
        { lat: 51, lng: 1 },
      ])

      expect(region?.center.lng).toBeCloseTo(0, 10)
      expect(region?.span.lng).toBeCloseTo(2.1, 10)
    })
  })

  it('distinguishes "nothing to show" from "show this"', () => {
    expect(mapKitBoundingRegion([])).toBeUndefined()
    expect(mapKitBoundingRegion([], { fallbackCenter: { lat: 30, lng: -88 } })).toStrictEqual({
      center: { lat: 30, lng: -88 },
      span: { lat: 0.08, lng: 0.1 },
    })
  })
})

describe('mapKitGeometryPoints', () => {
  it('reads GeoJSON lng/lat order', () => {
    expect(
      mapKitGeometryPoints({
        coordinates: [
          [-88, 30],
          [-87, 31],
        ],
        type: 'LineString',
      }),
    ).toStrictEqual([
      { lat: 30, lng: -88 },
      { lat: 31, lng: -87 },
    ])
  })

  it('takes the outer ring of a polygon and of every multipolygon member', () => {
    const polygon = mapKitGeometryPoints({
      coordinates: [
        [
          [-88, 30],
          [-87, 30],
        ],
        [[-87.5, 30.5]],
      ],
      type: 'Polygon',
    })
    expect(polygon).toStrictEqual([
      { lat: 30, lng: -88 },
      { lat: 30, lng: -87 },
    ])

    expect(
      mapKitGeometryPoints({
        coordinates: [[[[-88, 30]]], [[[-86, 32]]]],
        type: 'MultiPolygon',
      }),
    ).toStrictEqual([
      { lat: 30, lng: -88 },
      { lat: 32, lng: -86 },
    ])
  })

  it('returns nothing for a geometry it does not frame', () => {
    expect(mapKitGeometryPoints({ coordinates: [-88, 30], type: 'Point' })).toStrictEqual([])
    expect(mapKitGeometryPoints({ coordinates: null, type: 'LineString' })).toStrictEqual([])
  })
})
