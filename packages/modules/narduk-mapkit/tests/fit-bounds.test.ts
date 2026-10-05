import { describe, expect, it } from 'vitest'

import {
  fitMapKitRegionToViewport,
  latitudeFromMercatorDegrees,
  mercatorDegreesFromLatitude,
} from '../src/geometry/index.js'

/** What MapKit shows for a region: Mercator-centred, `latDelta` between the top and bottom edges. */
function visible(
  region: NonNullable<ReturnType<typeof fitMapKitRegionToViewport>>,
  viewport: { height: number; width: number },
) {
  const middle = mercatorDegreesFromLatitude(region.center.lat)
  // Solve for the height whose top-to-bottom latitude difference is latDelta.
  let low = 0
  let high = 360
  for (let step = 0; step < 80; step += 1) {
    const mid = (low + high) / 2
    const delta =
      latitudeFromMercatorDegrees(middle + mid / 2) - latitudeFromMercatorDegrees(middle - mid / 2)
    if (delta < region.span.latDelta) low = mid
    else high = mid
  }
  const height = (low + high) / 2
  // MapKit fits the region inside the canvas on both axes.
  const scale = Math.max(region.span.lngDelta / viewport.width, height / viewport.height)
  return {
    east: region.center.lng + (scale * viewport.width) / 2,
    north: latitudeFromMercatorDegrees(middle + (scale * viewport.height) / 2),
    south: latitudeFromMercatorDegrees(middle - (scale * viewport.height) / 2),
    west: region.center.lng - (scale * viewport.width) / 2,
  }
}

const TEXAS = [-106.645, 25.84, -93.517, 36.5] as const
const ALASKA = [-171.84, 54.391, -129.974, 71.353] as const

describe('fitMapKitRegionToViewport', () => {
  it('shows the whole box in a wide, short card, with the same room above and below', () => {
    const viewport = { height: 400, width: 1160 }
    const region = fitMapKitRegionToViewport(TEXAS, viewport)!
    const seen = visible(region, viewport)
    expect(seen.west).toBeLessThan(TEXAS[0])
    expect(seen.east).toBeGreaterThan(TEXAS[2])
    expect(seen.south).toBeLessThan(TEXAS[1])
    expect(seen.north).toBeGreaterThan(TEXAS[3])
    // Centred on screen: the Mercator gap above equals the gap below.
    const above = mercatorDegreesFromLatitude(seen.north) - mercatorDegreesFromLatitude(TEXAS[3])
    const below = mercatorDegreesFromLatitude(TEXAS[1]) - mercatorDegreesFromLatitude(seen.south)
    expect(above).toBeCloseTo(below, 6)
    // The height binds: 12% either side of the box, nothing more.
    const box = mercatorDegreesFromLatitude(TEXAS[3]) - mercatorDegreesFromLatitude(TEXAS[1])
    expect(above).toBeCloseTo(box * 0.12, 6)
  })

  it('shows the whole box in a tall, narrow card, where the width binds', () => {
    const viewport = { height: 900, width: 300 }
    const region = fitMapKitRegionToViewport(TEXAS, viewport)!
    const seen = visible(region, viewport)
    expect(seen.west).toBeLessThan(TEXAS[0])
    expect(seen.east).toBeGreaterThan(TEXAS[2])
    expect(seen.south).toBeLessThan(TEXAS[1])
    expect(seen.north).toBeGreaterThan(TEXAS[3])
    const room = TEXAS[0] - seen.west
    expect(room).toBeCloseTo((TEXAS[2] - TEXAS[0]) * 0.12, 6)
    expect(region.span.lngDelta).toBeCloseTo((TEXAS[2] - TEXAS[0]) * 1.24, 6)
  })

  it('centres on the box in Mercator space, not on the mean latitude', () => {
    const region = fitMapKitRegionToViewport(ALASKA, { height: 400, width: 1160 })!
    const mean = (ALASKA[1] + ALASKA[3]) / 2
    expect(region.center.lat).toBeGreaterThan(mean + 0.3)
    const middle =
      (mercatorDegreesFromLatitude(ALASKA[1]) + mercatorDegreesFromLatitude(ALASKA[3])) / 2
    expect(mercatorDegreesFromLatitude(region.center.lat)).toBeCloseTo(middle, 9)
  })

  it('fits every box in every aspect', () => {
    const boxes = [
      TEXAS,
      ALASKA,
      [-77.12, 38.792, -76.909, 38.996],
      [-160.3, 18.9, -154.8, 22.3],
    ] as const
    const viewports = [
      { height: 400, width: 1160 },
      { height: 230, width: 358 },
      { height: 900, width: 300 },
      { height: 500, width: 500 },
    ]
    for (const box of boxes) {
      for (const viewport of viewports) {
        const seen = visible(
          fitMapKitRegionToViewport(box, viewport, { minSpanDegrees: 1.5 })!,
          viewport,
        )
        expect(seen.west).toBeLessThanOrEqual(box[0])
        expect(seen.east).toBeGreaterThanOrEqual(box[2])
        expect(seen.south).toBeLessThanOrEqual(box[1])
        expect(seen.north).toBeGreaterThanOrEqual(box[3])
      }
    }
  })

  it('widens a box smaller than the minimum span', () => {
    const region = fitMapKitRegionToViewport(
      [-77.12, 38.792, -76.909, 38.996],
      { height: 400, width: 400 },
      { minSpanDegrees: 1.5 },
    )!
    expect(region.span.lngDelta).toBeGreaterThanOrEqual(1.5)
  })

  it('reads a box across the antimeridian the short way and keeps the centre in range', () => {
    const region = fitMapKitRegionToViewport([170, 50, -170, 60], { height: 400, width: 800 })!
    expect(region.center.lng).toBeCloseTo(180, 6)
    // 20 degrees wide the short way, so nowhere near the 340 the long way would need.
    expect(region.span.lngDelta).toBeGreaterThan(20)
    expect(region.span.lngDelta).toBeLessThan(60)
  })

  it('answers null for a box or a canvas that is not usable', () => {
    expect(fitMapKitRegionToViewport(TEXAS, { height: 0, width: 100 })).toBeNull()
    expect(fitMapKitRegionToViewport(TEXAS, { height: 100, width: Number.NaN })).toBeNull()
    expect(fitMapKitRegionToViewport([Number.NaN, 0, 1, 1], { height: 100, width: 100 })).toBeNull()
  })
})
