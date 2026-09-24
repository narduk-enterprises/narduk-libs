import { describe, expect, it } from 'vitest'

import { mapOverviewCamera, NORTH_AMERICA_OVERVIEW } from '../../src/marks/overview.js'

/**
 * buoys#142. The numbers in these cases are the live station index, not
 * invented shapes: `/api/stations` on the preview returned 1353 stations
 * spanning lat -47.0..71.3 and lng -179.8..180.0, with Indian-Ocean and western
 * Pacific DART buoys carrying `region: "atlantic-coast"`.
 */
describe('mapOverviewCamera (buoys#142)', () => {
  it('has nothing to frame without points', () => {
    expect(mapOverviewCamera([])).toBeNull()
    expect(mapOverviewCamera([{ lat: Number.NaN, lng: Number.NaN }])).toBeNull()
  })

  it('frames a regional set on its own data', () => {
    // The Gulf of Mexico card: lat 19.2..30.8, lng -97.5..-80.0 live.
    const camera = mapOverviewCamera([
      { lat: 19.2, lng: -97.5 },
      { lat: 25, lng: -90 },
      { lat: 30.8, lng: -80 },
    ])
    expect(camera?.center.lat).toBeCloseTo(25, 0)
    expect(camera?.center.lng).toBeCloseTo(-88.75, 0)
    expect(camera?.span.lat).toBeGreaterThan(11)
    expect(camera?.span.lng).toBeGreaterThan(21)
  })

  it('ignores outliers rather than letting them drag the frame off the data', () => {
    // Eight coastal stations and one mislabelled buoy in the Indian Ocean. The
    // bounding box of all nine is centred near Africa; the core is not.
    const coastal = Array.from({ length: 8 }, (_, index) => ({
      lat: 30 + index * 0.5,
      lng: -80 - index * 0.5,
    }))
    const camera = mapOverviewCamera([...coastal, { lat: -8, lng: 55 }])
    expect(camera?.center.lng).toBeLessThan(-70)
    expect(camera?.center.lat).toBeGreaterThan(25)
  })

  it('falls back to North America when the core is still wider than a third of the planet', () => {
    // The whole index trims to 173.7 degrees of longitude and `atlantic-coast`
    // to 208.3: a world map in a 274x120 card tells a reader nothing.
    const spread = Array.from({ length: 12 }, (_, index) => ({
      lat: 5 * index - 20,
      lng: 30 * index - 170,
    }))
    expect(mapOverviewCamera(spread)).toEqual(NORTH_AMERICA_OVERVIEW)
  })

  it('still frames the widest set that remains readable', () => {
    // `pacific-coast` is the real boundary case: 79.8 degrees of longitude from
    // the Aleutians to the California coast, framed on its own data.
    const camera = mapOverviewCamera([
      { lat: 17.1, lng: -179.8 },
      { lat: 40, lng: -140 },
      { lat: 59.5, lng: -100 },
    ])
    expect(camera).not.toEqual(NORTH_AMERICA_OVERVIEW)
    expect(camera?.center.lng).toBeCloseTo(-139.9, 0)
  })

  it('keeps a single station from zooming to a street', () => {
    const camera = mapOverviewCamera([{ lat: 27.5, lng: -84.2 }])
    expect(camera?.center).toEqual({ lat: 27.5, lng: -84.2 })
    expect(camera?.span).toEqual({ lat: 0.5, lng: 0.5 })
  })
})
