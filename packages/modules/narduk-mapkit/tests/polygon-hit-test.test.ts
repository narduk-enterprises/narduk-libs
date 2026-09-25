import { geoJsonFeatureToPolygonDrawables, hitTestPolygonOverlays } from '../src/geometry/index.js'

import type { MapKitGeoJsonFeature } from '../src/geometry/index.js'

/**
 * narduk-libs#931. A GeoJSON Polygon is `[outer, ...holes]`, and the overlay
 * layer hands every ring to `mapkit.PolygonOverlay`, which draws the holes
 * empty. A tap inside a hole is a tap on nothing.
 */
const lakeInPark: MapKitGeoJsonFeature = {
  type: 'Feature',
  id: 'park',
  properties: { name: 'Park' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      // Outer ring: a 10 x 10 degree square.
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      // Hole: the lake, 4..6 on both axes.
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  },
}

describe('hitTestPolygonOverlays (#931)', () => {
  const overlays = geoJsonFeatureToPolygonDrawables(lakeInPark)

  it('hits the polygon between its outer ring and its hole', () => {
    expect(hitTestPolygonOverlays({ lat: 2, lng: 2 }, overlays)?.id).toBe(overlays[0]!.id)
  })

  it('does not hit the polygon inside its hole', () => {
    expect(hitTestPolygonOverlays({ lat: 5, lng: 5 }, overlays)).toBeNull()
  })

  it('does not hit the polygon outside its outer ring', () => {
    expect(hitTestPolygonOverlays({ lat: 20, lng: 20 }, overlays)).toBeNull()
  })

  it('falls through a hole to a polygon drawn inside it', () => {
    const island = geoJsonFeatureToPolygonDrawables({
      type: 'Feature',
      id: 'island',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [4.5, 4.5],
            [5.5, 4.5],
            [5.5, 5.5],
            [4.5, 5.5],
            [4.5, 4.5],
          ],
        ],
      },
    })

    expect(hitTestPolygonOverlays({ lat: 5, lng: 5 }, [...overlays, ...island])?.id).toBe(
      island[0]!.id,
    )
  })
})
