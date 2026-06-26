import {
  computeCoordinateBounds,
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
})
