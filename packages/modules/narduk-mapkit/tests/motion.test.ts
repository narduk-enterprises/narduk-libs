import { describe, expect, it } from 'vitest'

import {
  MAPKIT_MAX_GLIDE_METRES,
  bearingDegrees,
  buildGlidePath,
  interpolateLatLng,
  mapKitSnapReason,
  normalizeHeading,
  pathAlongPolylines,
  pathEndHeading,
  pointAlongPath,
  shortestAngleDelta,
  unwrapHeading,
} from '../src/geometry/motion.js'

const ORIGIN = { lat: 30, lng: -88 }

describe('bearingDegrees', () => {
  it('is 0 north, 90 east, 180 south, 270 west', () => {
    expect(bearingDegrees(ORIGIN, { lat: 30.01, lng: -88 })).toBeCloseTo(0, 1)
    expect(bearingDegrees(ORIGIN, { lat: 30, lng: -87.99 })).toBeCloseTo(90, 1)
    expect(bearingDegrees(ORIGIN, { lat: 29.99, lng: -88 })).toBeCloseTo(180, 1)
    expect(bearingDegrees(ORIGIN, { lat: 30, lng: -88.01 })).toBeCloseTo(270, 1)
  })
})

describe('heading unwrapping', () => {
  it('measures the turn the short way round', () => {
    expect(shortestAngleDelta(350, 10)).toBe(20)
    expect(shortestAngleDelta(10, 350)).toBe(-20)
    expect(shortestAngleDelta(0, 180)).toBe(-180)
  })

  it('lets the heading pass 360 so a CSS transition never spins the long way', () => {
    expect(unwrapHeading(350, 10)).toBe(370)
    expect(unwrapHeading(370, 350)).toBe(350)
    expect(unwrapHeading(undefined, 123)).toBe(123)
  })

  it('normalizes back into [0, 360)', () => {
    expect(normalizeHeading(370)).toBe(10)
    expect(normalizeHeading(-10)).toBe(350)
  })
})

describe('mapKitSnapReason', () => {
  const near = { lat: 30.001, lng: -88 }

  it('lets a short move glide', () => {
    expect(mapKitSnapReason(ORIGIN, near)).toBeNull()
  })

  it('snaps a jump longer than a poll can travel', () => {
    expect(mapKitSnapReason(ORIGIN, { lat: 30.05, lng: -88 })).toBe('jump')
    expect(
      mapKitSnapReason(ORIGIN, { lat: 30.05, lng: -88 }, { maxGlideMetres: 10_000 }),
    ).toBeNull()
    expect(MAPKIT_MAX_GLIDE_METRES).toBe(1500)
  })

  it('snaps for a first fix, a hidden tab and reduced motion, in that order of precedence', () => {
    expect(mapKitSnapReason(ORIGIN, near, { reducedMotion: true })).toBe('reduced-motion')
    expect(mapKitSnapReason(ORIGIN, near, { hidden: true, reducedMotion: true })).toBe('hidden')
    expect(mapKitSnapReason(ORIGIN, near, { first: true, hidden: true })).toBe('first')
  })
})

describe('interpolateLatLng', () => {
  it('is linear', () => {
    expect(interpolateLatLng({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 0.25)).toStrictEqual({
      lat: 2.5,
      lng: 5,
    })
  })
})

describe('glide paths', () => {
  const line = [
    { lat: 30, lng: -88 },
    { lat: 30, lng: -87.99 },
    { lat: 30.01, lng: -87.99 },
  ]

  it('walks a polyline by distance, not by vertex', () => {
    const path = buildGlidePath(line)
    const total = path.cumulative.at(-1) ?? 0
    expect(path.cumulative[0]).toBe(0)
    expect(pointAlongPath(path, 0)).toStrictEqual(line[0])
    expect(pointAlongPath(path, 1)).toStrictEqual(line[2])
    const half = pointAlongPath(path, 0.5)
    expect(half.lat).toBeGreaterThanOrEqual(30)
    // Half the distance has to be a point whose cumulative position is half the total.
    expect(total).toBeGreaterThan(0)
  })

  it('clamps t outside 0 to 1 and handles a zero-length path', () => {
    const path = buildGlidePath(line)
    expect(pointAlongPath(path, -3)).toStrictEqual(line[0])
    expect(pointAlongPath(path, 9)).toStrictEqual(line[2])
    expect(pointAlongPath(buildGlidePath([ORIGIN, ORIGIN]), 0.5)).toStrictEqual(ORIGIN)
    expect(() => pointAlongPath(buildGlidePath([]), 0.5)).toThrow(RangeError)
  })

  it('follows the corner of a route between two fixes on it', () => {
    const path = pathAlongPolylines([line], line[0]!, line[2]!)
    expect(path).not.toBeNull()
    expect(path?.points).toContainEqual(line[1])
    // Not the straight diagonal: the midpoint stays on the first leg.
    expect(pointAlongPath(path!, 0.3).lat).toBeCloseTo(30, 4)
  })

  it('runs the line backwards when the fixes are in the other order', () => {
    const path = pathAlongPolylines([line], line[2]!, line[0]!)
    expect(path?.points[0]).toStrictEqual(line[2])
    expect(path?.points.at(-1)).toStrictEqual(line[0])
  })

  it('glides straight (null) when a fix is off the line', () => {
    const off = { lat: 30.01, lng: -88 }
    expect(pathAlongPolylines([line], line[0]!, off)).toBeNull()
  })

  it('glides straight when the way along the line is a long detour', () => {
    const uTurn = [
      { lat: 30, lng: -88 },
      { lat: 30, lng: -87.9 },
      { lat: 30.0005, lng: -87.9 },
      { lat: 30.0005, lng: -88 },
    ]
    expect(pathAlongPolylines([uTurn], uTurn[0]!, uTurn[3]!)).toBeNull()
  })

  it('reports the heading where the path ends', () => {
    const path = pathAlongPolylines([line], line[0]!, line[2]!)!
    expect(pathEndHeading(path)).toBeCloseTo(0, 0)
    expect(pathEndHeading(buildGlidePath([ORIGIN, ORIGIN]))).toBeNull()
  })
})
