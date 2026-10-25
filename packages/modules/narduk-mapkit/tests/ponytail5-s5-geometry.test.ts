// ponytail-5 s5 regression tests: antimeridian handling in the geometry helpers.
import { describe, expect, it } from 'vitest'

import { anyCloserThanPixels, collapseNearbyPoints } from '../src/geometry/declutter.js'
import { hitTestLineOverlays, pointInPolygon } from '../src/geometry/geometry.js'
import { nextMapKitRovingKey } from '../src/geometry/roving.js'

describe('mapkit-src #5: metre grid across +-180', () => {
  const pair = [
    { lat: 0, lng: 179.9 },
    { lat: 0, lng: -179.9 },
  ]
  it('sees neighbours either side of the antimeridian', () => {
    expect(anyCloserThanPixels(pair, 20, 10, 400)).toBe(true)
    expect(collapseNearbyPoints(pair, { maxMetres: 50_000 })).toHaveLength(1)
  })
})

describe('mapkit-src #6: arrow keys across +-180', () => {
  it('moves east over the date line', () => {
    const points = [
      { key: 'a', lat: 0, lng: 179 },
      { key: 'b', lat: 0, lng: -179.5 },
    ]
    expect(nextMapKitRovingKey(points, 'a', 'east')).toBe('b')
    expect(nextMapKitRovingKey(points, 'b', 'west')).toBe('a')
  })
})

describe('mapkit-src #7: polygon and line hits across +-180', () => {
  const ring = [
    { lat: 0, lng: 179 },
    { lat: 10, lng: 179 },
    { lat: 10, lng: -179 },
    { lat: 0, lng: -179 },
  ]
  it('contains the strip over the date line and not the Atlantic', () => {
    expect(pointInPolygon({ lat: 5, lng: 179.5 }, ring)).toBe(true)
    expect(pointInPolygon({ lat: 5, lng: -179.5 }, ring)).toBe(true)
    expect(pointInPolygon({ lat: 5, lng: 0 }, ring)).toBe(false)
  })
  it('hits a line segment that crosses the date line', () => {
    const overlay = {
      coordinates: [
        { lat: 0, lng: 179.9 },
        { lat: 0, lng: -179.9 },
      ],
      id: 'l',
    }
    expect(hitTestLineOverlays({ lat: 0, lng: 180 }, [overlay as never])).not.toBeNull()
    expect(hitTestLineOverlays({ lat: 0, lng: 0 }, [overlay as never])).toBeNull()
  })
})
