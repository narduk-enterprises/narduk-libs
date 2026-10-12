import { describe, expect, it } from 'vitest'

import {
  createMapView,
  fitBounds,
  mercatorX,
  mercatorY,
  projectGeometry,
  projectionStats,
  unmercatorX,
  unmercatorY,
} from './projection'

import type { ShapeGeometry } from './types'

describe('web mercator', () => {
  it('round-trips lon/lat through the unit world', () => {
    expect(unmercatorX(mercatorX(-71.3))).toBeCloseTo(-71.3, 9)
    expect(unmercatorY(mercatorY(41.5))).toBeCloseTo(41.5, 9)
    expect(mercatorX(0)).toBe(0.5)
    expect(mercatorY(0)).toBeCloseTo(0.5, 12)
  })
})

describe('fitBounds parity with the GL engine camera maths', () => {
  // Hand-computed from the 512px-world camera formula (zoom = log2 of the pixel scale over the
  // 512px world), with the mercator y taken from ln(tan(pi/4 + lat/2)): bounds
  // [-71.4, 41.4, -71.2, 41.6] in a 500 x 400 box.
  const bounds: [number, number, number, number] = [-71.4, 41.4, -71.2, 41.6]

  it('matches the zoom for uniform padding', () => {
    const fit = fitBounds(bounds, { width: 500, height: 400 }, 20)
    expect(fit.zoom).toBeCloseTo(9.88858474, 6)
    // Uniform padding leaves the centre at the mercator midpoint.
    expect(fit.center[0]).toBeCloseTo(-71.3, 9)
  })

  it('matches zoom and centre for asymmetric padding', () => {
    const fit = fitBounds(
      bounds,
      { width: 500, height: 400 },
      { top: 10, right: 30, bottom: 50, left: 20 },
    )
    expect(fit.zoom).toBeCloseTo(9.80612258, 6)
    expect(fit.center[0]).toBeCloseTo(-71.29607296, 6)
    expect(fit.center[1]).toBeCloseTo(41.48831143, 6)
  })

  it('caps the zoom at maxZoom for a point', () => {
    const fit = fitBounds([-71, 41, -71, 41], { width: 100, height: 100 }, 0, 18)
    expect(fit.zoom).toBe(18)
  })

  it('puts the view centre where the camera centre is', () => {
    const view = createMapView({ bounds, width: 500, height: 400, padding: 20 })
    const [x, y] = view.project(view.center[0], view.center[1])
    expect(x).toBeCloseTo(250, 1)
    expect(y).toBeCloseTo(200, 1)
    // The SVG scale is the GL world size at the fitted zoom.
    expect(view.scale).toBeCloseTo(512 * 2 ** view.zoom, 6)
  })

  it('lines up with the GL pixel of a corner for the same size and padding', () => {
    const view = createMapView({ bounds, width: 500, height: 400, padding: 20 })
    // The bounds' west edge sits at padding.left or inward (the limiting axis fills it).
    const [west] = view.project(bounds[0], 41.5)
    const [east] = view.project(bounds[2], 41.5)
    expect(west).toBeGreaterThanOrEqual(20 - 0.01)
    expect(east).toBeLessThanOrEqual(480 + 0.01)
    // Height 400 limits the fit, so the north edge is at the top padding exactly.
    const [, north] = view.project(-71.3, bounds[3])
    const [, south] = view.project(-71.3, bounds[1])
    expect(north).toBeCloseTo(20, 1)
    expect(south).toBeCloseTo(380, 1)
  })

  it('derives the height from the bounds when none is given', () => {
    const view = createMapView({ bounds, width: 500, padding: 20 })
    const [west] = view.project(bounds[0], 41.5)
    const [east] = view.project(bounds[2], 41.5)
    expect(west).toBeCloseTo(20, 1)
    expect(east).toBeCloseTo(480, 1)
    const [, north] = view.project(-71.3, bounds[3])
    const [, south] = view.project(-71.3, bounds[1])
    expect(north).toBeCloseTo(20, 1)
    expect(south).toBeCloseTo(view.height - 20, 1)
  })

  it('returns the same view object for the same options', () => {
    const a = createMapView({ bounds, width: 500, padding: 20 })
    const b = createMapView({ bounds: [...bounds], width: 500, padding: 20 })
    expect(a).toBe(b)
  })
})

describe('projected path cache', () => {
  const geometry: ShapeGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [-71.4, 41.4],
        [-71.2, 41.4],
        [-71.2, 41.6],
        [-71.4, 41.6],
        [-71.4, 41.4],
      ],
    ],
  }

  it('projects a geometry object once per view', () => {
    const view = createMapView({ bounds: [-71.4, 41.4, -71.2, 41.6], width: 300, padding: 10 })
    const before = projectionStats.rings
    const first = projectGeometry(geometry, view)
    const afterFirst = projectionStats.rings
    const second = projectGeometry(geometry, view)
    const third = projectGeometry(geometry, view)
    expect(afterFirst - before).toBe(1)
    expect(projectionStats.rings).toBe(afterFirst)
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(first.d.startsWith('M')).toBe(true)
    expect(first.d.endsWith('Z')).toBe(true)
  })

  it('projects again for a different view', () => {
    const a = createMapView({ bounds: [-71.4, 41.4, -71.2, 41.6], width: 300, padding: 10 })
    const b = createMapView({ bounds: [-71.4, 41.4, -71.2, 41.6], width: 400, padding: 10 })
    projectGeometry(geometry, a)
    const before = projectionStats.rings
    projectGeometry(geometry, b)
    expect(projectionStats.rings - before).toBe(1)
  })
})
