import { describe, expect, it } from 'vitest'

import {
  anyCloserThanPixels,
  chooseMapKitMarkerTier,
  chooseMapKitSpanTier,
  collapseNearbyPoints,
  isInVisibleRegion,
  metersPerPixel,
  minSeparationPixels,
  pointsInVisibleRegion,
} from '../src/geometry/declutter.js'

// 0.001 degrees of latitude is ~111 m.
const A = { lat: 30, lng: -88 }
const B = { lat: 30.001, lng: -88 }
const REGION = { centerLat: 30, centerLng: -88, latDelta: 0.02, lngDelta: 0.02 }

describe('metersPerPixel', () => {
  it('divides the visible latitude span by the map height', () => {
    expect(metersPerPixel(0.1, 1113.2)).toBeCloseTo(10, 1)
    expect(metersPerPixel(0.1, 0)).toBeGreaterThan(0)
  })
})

describe('visible region', () => {
  it('keeps points inside, with a padding margin, and drops the rest', () => {
    expect(isInVisibleRegion({ lat: 30.009, lng: -88 }, REGION, 0)).toBe(true)
    expect(isInVisibleRegion({ lat: 30.011, lng: -88 }, REGION, 0)).toBe(false)
    expect(isInVisibleRegion({ lat: 30.011, lng: -88 }, REGION, 0.1)).toBe(true)
    expect(pointsInVisibleRegion([A, { lat: 31, lng: -88 }], REGION)).toStrictEqual([A])
  })

  it('wraps longitude across the antimeridian', () => {
    const region = { centerLat: 0, centerLng: 179.99, latDelta: 1, lngDelta: 0.1 }
    expect(isInVisibleRegion({ lat: 0, lng: -179.99 }, region, 0)).toBe(true)
    expect(isInVisibleRegion({ lat: 0, lng: -170 }, region, 0)).toBe(false)
  })
})

describe('separation on screen', () => {
  it('measures the smallest pixel gap and ignores the same spot', () => {
    // 111 m apart at 10 m/px is ~11 px.
    const px = minSeparationPixels([A, B], 0.1, 1113.2)
    expect(px).toBeCloseTo(11.1, 0)
    expect(minSeparationPixels([A, { lat: 30.00005, lng: -88 }], 0.1, 1113.2)).toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(minSeparationPixels([A], 0.1, 1000)).toBe(Number.POSITIVE_INFINITY)
  })

  it('agrees with the pairwise answer without comparing every pair', () => {
    expect(anyCloserThanPixels([A, B], 20, 0.1, 1113.2)).toBe(true)
    expect(anyCloserThanPixels([A, B], 5, 0.1, 1113.2)).toBe(false)
    expect(anyCloserThanPixels([A], 20, 0.1, 1113.2)).toBe(false)
    const far = Array.from({ length: 500 }, (_, i) => ({ lat: 30 + i * 0.01, lng: -88 }))
    expect(anyCloserThanPixels(far, 20, 0.1, 1113.2)).toBe(false)
  })
})

describe('chooseMapKitMarkerTier', () => {
  const base = { mapHeightPx: 1113.2, markerPx: 20, points: [A, B] }

  it('uses the unknown-span tier before the map reports', () => {
    expect(chooseMapKitMarkerTier({ ...base, span: null })).toBe('symbol')
    expect(chooseMapKitMarkerTier({ ...base, span: null, unknownSpanTier: 'dot' })).toBe('dot')
  })

  it('drops to dots only when measured markers would overlap', () => {
    expect(chooseMapKitMarkerTier({ ...base, span: 0.1 })).toBe('dot')
    expect(chooseMapKitMarkerTier({ ...base, span: 0.02 })).toBe('symbol')
  })

  it('goes to detail when close in and uncrowded', () => {
    expect(chooseMapKitMarkerTier({ ...base, detailBelowSpan: 0.03, span: 0.02 })).toBe('detail')
  })

  it('needs more room to leave dots than to enter them', () => {
    // ~22 px apart at this span: enough to enter symbols (20) but not to leave dots (24).
    const span = 0.0505
    expect(chooseMapKitMarkerTier({ ...base, span })).toBe('symbol')
    expect(chooseMapKitMarkerTier({ ...base, previous: 'dot', span })).toBe('dot')
  })

  it('counts only markers in view', () => {
    const far = { lat: 31, lng: -88 }
    expect(
      chooseMapKitMarkerTier({
        ...base,
        points: [A, far, { lat: 31.0005, lng: -88 }],
        region: REGION,
        span: 0.02,
      }),
    ).toBe('symbol')
  })

  it('does not let two markers at one spot hold everything in dots', () => {
    expect(
      chooseMapKitMarkerTier({ ...base, points: [A, { lat: 30.00002, lng: -88 }], span: 0.1 }),
    ).toBe('symbol')
  })
})

describe('chooseMapKitSpanTier', () => {
  const tiers = [
    { maxSpan: 0.03, tier: 'full' },
    { maxSpan: 0.012, tier: 'pairs' },
  ]

  it('picks the tightest tier the span fits, else the fallback', () => {
    expect(chooseMapKitSpanTier(0.01, tiers, 'small')).toBe('pairs')
    expect(chooseMapKitSpanTier(0.02, tiers, 'small')).toBe('full')
    expect(chooseMapKitSpanTier(0.2, tiers, 'small')).toBe('small')
    expect(chooseMapKitSpanTier(null, tiers, 'small')).toBe('small')
  })

  it('holds the previous tier just past its edge', () => {
    expect(chooseMapKitSpanTier(0.0125, tiers, 'small', 'pairs')).toBe('pairs')
    expect(chooseMapKitSpanTier(0.0125, tiers, 'small')).toBe('full')
    expect(chooseMapKitSpanTier(0.2, tiers, 'small', 'pairs')).toBe('small')
  })
})

describe('collapseNearbyPoints', () => {
  const items = [
    { id: 'a', lat: 30, lng: -88 },
    { id: 'b', lat: 30.0002, lng: -88 }, // ~22 m from a
    { id: 'c', lat: 30.01, lng: -88 },
    { id: 'd', lat: 30.0001, lng: -88 }, // ~11 m from a
  ]

  it('keeps the first of a group on its own coordinate and lists the rest as members', () => {
    const out = collapseNearbyPoints(items)
    expect(out.map((entry) => entry.item.id)).toStrictEqual(['a', 'c'])
    expect(out[0]?.members.map((m) => m.id)).toStrictEqual(['b', 'd'])
    expect(out[0]?.item).toBe(items[0])
  })

  it('leaves pinned and non-mergeable items alone', () => {
    const out = collapseNearbyPoints(items, { pinned: (item) => item.id === 'b' })
    expect(out.map((entry) => entry.item.id)).toStrictEqual(['a', 'b', 'c'])
    expect(collapseNearbyPoints(items, { mergeable: () => false })).toHaveLength(4)
  })

  it('honours maxMetres', () => {
    expect(collapseNearbyPoints(items, { maxMetres: 5 })).toHaveLength(4)
  })
})
