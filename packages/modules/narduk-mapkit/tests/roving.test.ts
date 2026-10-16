import { describe, expect, it } from 'vitest'

import { nextMapKitRovingKey } from '../src/geometry/roving.js'

import type { MapKitRovingPoint } from '../src/geometry/roving.js'

// A small grid, north at the top:
//
//   n1 (31, -88)      n2 (31, -87)
//   w  (30, -89)  c (30, -88)  e (30, -87)
//                 s (29, -88)
const GRID: MapKitRovingPoint[] = [
  { key: 'n1', lat: 31, lng: -88 },
  { key: 'n2', lat: 31, lng: -87 },
  { key: 'w', lat: 30, lng: -89 },
  { key: 'c', lat: 30, lng: -88 },
  { key: 'e', lat: 30, lng: -87 },
  { key: 's', lat: 29, lng: -88 },
]

describe('nextMapKitRovingKey', () => {
  it('moves to the nearest pin in each compass direction', () => {
    expect(nextMapKitRovingKey(GRID, 'c', 'north')).toBe('n1')
    expect(nextMapKitRovingKey(GRID, 'c', 'south')).toBe('s')
    expect(nextMapKitRovingKey(GRID, 'c', 'east')).toBe('e')
    expect(nextMapKitRovingKey(GRID, 'c', 'west')).toBe('w')
  })

  it('prefers the pin straight ahead over a nearer one off to the side', () => {
    const points: MapKitRovingPoint[] = [
      { key: 'from', lat: 30, lng: -88 },
      { key: 'ahead', lat: 30, lng: -87.6 },
      { key: 'aside', lat: 30.3, lng: -87.9 },
    ]
    expect(nextMapKitRovingKey(points, 'from', 'east')).toBe('ahead')
  })

  it('stays put at the edge of the group', () => {
    expect(nextMapKitRovingKey(GRID, 's', 'south')).toBeNull()
    expect(nextMapKitRovingKey(GRID, 'w', 'west')).toBeNull()
  })

  it('does not treat a pin level with the origin as being in the perpendicular direction', () => {
    const points: MapKitRovingPoint[] = [
      { key: 'a', lat: 30, lng: -88 },
      { key: 'b', lat: 30, lng: -87 },
    ]
    expect(nextMapKitRovingKey(points, 'a', 'north')).toBeNull()
    expect(nextMapKitRovingKey(points, 'a', 'south')).toBeNull()
  })

  it('goes to the first and last pin in reading order for Home and End', () => {
    // North to south, then west to east.
    expect(nextMapKitRovingKey(GRID, 'c', 'first')).toBe('n1')
    expect(nextMapKitRovingKey(GRID, 'c', 'last')).toBe('s')
    expect(nextMapKitRovingKey(GRID, null, 'first')).toBe('n1')
  })

  it('starts at the first pin when there is no current one, or it has gone', () => {
    expect(nextMapKitRovingKey(GRID, null, 'east')).toBe('n1')
    expect(nextMapKitRovingKey(GRID, 'removed', 'south')).toBe('n1')
  })

  it('answers null for an empty group', () => {
    expect(nextMapKitRovingKey([], null, 'first')).toBeNull()
    expect(nextMapKitRovingKey([], 'x', 'east')).toBeNull()
  })

  it('breaks ties by key so the answer is stable', () => {
    const points: MapKitRovingPoint[] = [
      { key: 'from', lat: 30, lng: -88 },
      { key: 'b', lat: 30, lng: -87 },
      { key: 'a', lat: 30, lng: -87 },
    ]
    expect(nextMapKitRovingKey(points, 'from', 'east')).toBe('a')
  })

  it('scales longitude by latitude so east-west distance is true distance', () => {
    // At 60N a degree of longitude is half a degree of latitude long. Unscaled,
    // `near` (0.8 deg east, 0.15 north) would beat `ahead` (1.2 deg east, level);
    // true distances are 0.4 + 0.3 = 0.7 against 0.6, so `ahead` wins.
    const points: MapKitRovingPoint[] = [
      { key: 'from', lat: 60, lng: 0 },
      { key: 'ahead', lat: 60, lng: 1.2 },
      { key: 'near', lat: 60.15, lng: 0.8 },
    ]
    expect(nextMapKitRovingKey(points, 'from', 'east')).toBe('ahead')
  })
})
