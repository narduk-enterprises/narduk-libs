import {
  collectMapKitDrawablePoints,
  collectMapKitPointsFromGeoJson,
  computeCoordinateBounds,
  computeMapKitRegionForDrawables,
  computeMapKitRegionForGeoJson,
  computeMapKitRegionForLngLatBounds,
  computeMapKitRegionForPoints,
  computeRouteDistanceMetres,
  normalizeCoordinate,
} from '../src/geometry/index.js'

describe('geometry helpers', () => {
  it('normalizes coordinates and computes useful bounds', () => {
    expect(normalizeCoordinate(95.1234567, -181.5)).toEqual({ lat: 90, lng: -180 })

    const bounds = computeCoordinateBounds([
      { lat: 30.25, lng: -97.75 },
      { lat: 30.5, lng: -97.25 },
    ])

    expect(bounds?.centerLat).toBe(30.375)
    expect(bounds?.centerLng).toBe(-97.5)
  })

  it('measures route distance from plain points', () => {
    const distance = computeRouteDistanceMetres([
      { lat: 30.25, lng: -97.75 },
      { lat: 30.26, lng: -97.75 },
    ])

    expect(distance).toBeGreaterThan(1000)
    expect(distance).toBeLessThan(1200)
  })

  it('computes MapKit regions for points crossing the antimeridian', () => {
    const region = computeMapKitRegionForPoints(
      [
        { lat: 10, lng: 179 },
        { lat: 12, lng: -179 },
      ],
      { minSpanDelta: 0.01, padding: 0 },
    )

    expect(region).toEqual({
      center: { lat: 11, lng: -180 },
      span: { latDelta: 2, lngDelta: 2 },
    })
  })

  it('computes MapKit regions from lng/lat tile bounds', () => {
    const region = computeMapKitRegionForLngLatBounds([-180, -70, 180, 70], {
      minSpanDelta: 0.1,
      padding: 0,
    })

    expect(region).toEqual({
      center: { lat: 0, lng: 0 },
      span: { latDelta: 140, lngDelta: 360 },
    })
  })

  it('collects GeoJSON and drawable points for shared map framing', () => {
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: { name: 'Austin' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-97.8, 30.2],
                [-97.7, 30.2],
                [-97.7, 30.3],
                [-97.8, 30.2],
              ],
            ],
          },
        },
      ],
    }

    expect(collectMapKitPointsFromGeoJson(geojson)).toHaveLength(4)
    expect(
      collectMapKitDrawablePoints({
        geojson,
        markers: [{ id: 'pin', lat: 30.25, lng: -97.75 }],
        points: [{ lat: 30.27, lng: -97.74 }],
      }),
    ).toHaveLength(6)

    expect(computeMapKitRegionForGeoJson(geojson)?.center).toEqual({
      lat: 30.25,
      lng: -97.75,
    })
    expect(
      computeMapKitRegionForDrawables({
        lines: [{ id: 'line', coordinates: [{ lat: 30.2, lng: -97.8 }, { lat: 30.3, lng: -97.7 }] }],
      })?.span,
    ).toMatchObject({ latDelta: expect.any(Number), lngDelta: expect.any(Number) })
  })
})
