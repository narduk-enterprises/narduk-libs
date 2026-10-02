import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_MOUSE_HIT_TOLERANCE_PX,
  DEFAULT_TOUCH_HIT_TOLERANCE_PX,
  POINT_CLASS_NO_DATA,
  POINT_CLASS_NOT_REPORTING,
  buildDecodedVectorTile,
  createPointLayer,
  createVectorTileOverlaySource,
  hitTolerancePx,
  resolveHit,
} from '../src/client/index.js'

import { createFakeCanvas } from './vector-tiles/fake-canvas.js'

import type { HitLayer, HitProbe, PointClassTable, PointLayerCanvas } from '../src/client/index.js'
import type { FakeCanvas } from './vector-tiles/fake-canvas.js'

const ZOOM = 12
const TILE = { x: 100, y: 200 }
const PROBE_X = 0.5

/** The coordinate at a fraction of the zoom-12 tile under test. */
function coordinateAt(fractionX: number, fractionY: number) {
  const n = 2 ** ZOOM
  const longitude = ((TILE.x + fractionX) / n) * 360 - 180
  const mercator = Math.PI * (1 - (2 * (TILE.y + fractionY)) / n)
  const latitude = (Math.atan(Math.sinh(mercator)) * 180) / Math.PI
  return { latitude, longitude }
}

/** A probe `pixels` screen pixels south of the river across the tile's middle. */
function probeBelowRiver(pixels: number) {
  return coordinateAt(PROBE_X, 0.5 + pixels / 256)
}

async function riverOverlay() {
  const tile = buildDecodedVectorTile(4096, [
    {
      lines: [
        [
          { x: 0, y: 2048 },
          { x: 4096, y: 2048 },
        ],
      ],
      properties: { name: 'river' },
      si: 7,
    },
  ])
  const overlay = createVectorTileOverlaySource<FakeCanvas>({
    createCanvas: createFakeCanvas,
    decode: async () => tile,
    style: () => ({ color: '#2563eb', width: 1 }),
    tileBytes: async () => new Uint8Array([1]),
  })
  await overlay.imageForTile(TILE.x, TILE.y, ZOOM, 1)
  return overlay
}

function dotTable(): PointClassTable {
  return {
    [POINT_CLASS_NO_DATA]: { fill: '#94a3b8', order: 0, radius: 3, stroke: '#475569' },
    [POINT_CLASS_NOT_REPORTING]: { fill: '#e2e8f0', order: 1, radius: 3, stroke: '#94a3b8' },
    0: { fill: '#16a34a', order: 2, radius: 3, stroke: '#14532d' },
  }
}

/** Hit tests never paint; a canvas with no context satisfies the type. */
function createPointCanvas(width: number, height: number): PointLayerCanvas {
  return { height, width, getContext: () => null }
}

function dotsAt(
  at: Array<{ fractionX: number; fractionY: number; klass: number }>,
  style: PointClassTable = dotTable(),
) {
  const positions = new Float64Array(at.length * 2)
  for (const [index, entry] of at.entries()) {
    const coordinate = coordinateAt(entry.fractionX, entry.fractionY)
    positions[index * 2] = coordinate.longitude
    positions[index * 2 + 1] = coordinate.latitude
  }
  return createPointLayer({
    classes: Uint8Array.from(at.map((entry) => entry.klass)),
    createCanvas: createPointCanvas,
    positions,
    style,
  })
}

describe('resolveHit priority', () => {
  it('returns the dot when a dot and a line are under the same point', async () => {
    const line = await riverOverlay()
    const dots = dotsAt([{ fractionX: PROBE_X, fractionY: 0.5, klass: 0 }])
    const result = resolveHit({
      coordinate: coordinateAt(PROBE_X, 0.5),
      layers: [
        { kind: 'point', layer: dots },
        { kind: 'line', source: line },
        { kind: 'area', test: () => ({ id: 'flood-watch' }) },
      ],
      zoom: ZOOM,
    })
    expect(result).toEqual({ hit: 0, kind: 'point' })
  })

  it('returns the line when there is no dot, then the area when there is no line', async () => {
    const line = await riverOverlay()
    const area = { id: 'flood-watch' }
    const layers: Array<HitLayer<typeof area>> = [
      { kind: 'point', layer: dotsAt([{ fractionX: 0.1, fractionY: 0.9, klass: 0 }]) },
      { kind: 'line', source: line },
      { kind: 'area', test: () => area },
    ]

    const onRiver = resolveHit({ coordinate: coordinateAt(PROBE_X, 0.5), layers, zoom: ZOOM })
    expect(onRiver?.kind).toBe('line')
    expect(onRiver?.kind === 'line' && onRiver.hit.properties.name).toBe('river')

    // 100 px from the river and from the dot: only the area is left.
    const inArea = resolveHit({ coordinate: probeBelowRiver(100), layers, zoom: ZOOM })
    expect(inArea).toEqual({ hit: area, kind: 'area' })
  })

  it('returns null when no layer reports a hit', async () => {
    const line = await riverOverlay()
    const result = resolveHit({
      coordinate: probeBelowRiver(100),
      layers: [
        { kind: 'point', layer: dotsAt([{ fractionX: 0.1, fractionY: 0.9, klass: 0 }]) },
        { kind: 'line', source: line },
        { kind: 'area', test: () => null },
      ],
      zoom: ZOOM,
    })
    expect(result).toBeNull()
    expect(resolveHit({ coordinate: coordinateAt(0.5, 0.5), layers: [], zoom: ZOOM })).toBeNull()
  })

  it('does not ask a later layer once a layer has hit, and follows the order given', () => {
    const lineHitTest = vi.fn(() => null)
    const areaTest = vi.fn(() => ({ id: 'a' }))
    const dots = { nearestPoint: vi.fn(() => 4) }
    const coordinate = coordinateAt(0.5, 0.5)

    resolveHit({
      coordinate,
      layers: [
        { kind: 'point', layer: dots },
        { kind: 'line', source: { hitTest: lineHitTest } },
        { kind: 'area', test: areaTest },
      ],
      zoom: ZOOM,
    })
    expect(dots.nearestPoint).toHaveBeenCalledTimes(1)
    expect(lineHitTest).not.toHaveBeenCalled()
    expect(areaTest).not.toHaveBeenCalled()

    // Reordered, the area is first and wins; the dots are not asked.
    dots.nearestPoint.mockClear()
    const result = resolveHit({
      coordinate,
      layers: [
        { kind: 'area', test: areaTest },
        { kind: 'point', layer: dots },
      ],
      zoom: ZOOM,
    })
    expect(result).toEqual({ hit: { id: 'a' }, kind: 'area' })
    expect(dots.nearestPoint).not.toHaveBeenCalled()
  })

  it('treats a dot at index 0 as a hit, and an undefined area as a miss', () => {
    const coordinate = coordinateAt(0.5, 0.5)
    const zero = resolveHit({
      coordinate,
      layers: [{ kind: 'point', layer: { nearestPoint: () => 0 } }],
      zoom: ZOOM,
    })
    expect(zero).toEqual({ hit: 0, kind: 'point' })
    expect(
      resolveHit({ coordinate, layers: [{ kind: 'area', test: () => {} }], zoom: ZOOM }),
    ).toBeNull()
  })
})

describe('resolveHit tolerance', () => {
  it('names the defaults: 8 px for a mouse, 22 px (half of 44) for touch', () => {
    expect(DEFAULT_MOUSE_HIT_TOLERANCE_PX).toBe(8)
    expect(DEFAULT_TOUCH_HIT_TOLERANCE_PX).toBe(22)
    expect(hitTolerancePx('mouse')).toBe(8)
    expect(hitTolerancePx('pen')).toBe(8)
    expect(hitTolerancePx('touch')).toBe(22)
  })

  it('reaches with touch a line 15 px away that the mouse misses', async () => {
    const line = await riverOverlay()
    const layers: HitLayer[] = [{ kind: 'line', source: line }]
    const coordinate = probeBelowRiver(15)

    expect(resolveHit({ coordinate, layers, pointer: 'mouse', zoom: ZOOM })).toBeNull()
    expect(resolveHit({ coordinate, layers, pointer: 'pen', zoom: ZOOM })).toBeNull()
    const touch = resolveHit({ coordinate, layers, pointer: 'touch', zoom: ZOOM })
    expect(touch?.kind).toBe('line')
    // Still a miss beyond the touch radius.
    expect(
      resolveHit({ coordinate: probeBelowRiver(30), layers, pointer: 'touch', zoom: ZOOM }),
    ).toBeNull()
  })

  it('hands every layer the resolved tolerance, and defaults to a mouse', () => {
    const seen: HitProbe[] = []
    const layers: HitLayer[] = [
      {
        kind: 'area',
        test: (probe) => {
          seen.push(probe)
          return null
        },
      },
    ]
    const coordinate = coordinateAt(0.5, 0.5)
    resolveHit({ coordinate, layers, zoom: ZOOM })
    resolveHit({ coordinate, layers, pointer: 'touch', zoom: ZOOM })
    expect(seen.map((probe) => [probe.pointer, probe.tolerancePx, probe.zoom])).toEqual([
      ['mouse', 8, ZOOM],
      ['touch', 22, ZOOM],
    ])
  })

  it('lets a caller override each tolerance, independently', async () => {
    const line = await riverOverlay()
    const layers: HitLayer[] = [{ kind: 'line', source: line }]
    const coordinate = probeBelowRiver(15)

    // A wider mouse reaches what the default mouse missed.
    expect(
      resolveHit({ coordinate, layers, mouseTolerancePx: 16, pointer: 'mouse', zoom: ZOOM })?.kind,
    ).toBe('line')
    // A narrower touch no longer reaches it; the mouse override does not leak in.
    expect(
      resolveHit({ coordinate, layers, pointer: 'touch', touchTolerancePx: 10, zoom: ZOOM }),
    ).toBeNull()
    expect(
      resolveHit({
        coordinate,
        layers,
        mouseTolerancePx: 100,
        pointer: 'touch',
        touchTolerancePx: 10,
        zoom: ZOOM,
      }),
    ).toBeNull()
    // An override of one kind leaves the other at its default.
    expect(
      resolveHit({ coordinate, layers, pointer: 'mouse', touchTolerancePx: 100, zoom: ZOOM }),
    ).toBeNull()
  })

  it('rejects a tolerance that is not a number >= 0', () => {
    const layers: HitLayer[] = []
    const coordinate = coordinateAt(0.5, 0.5)
    expect(() => resolveHit({ coordinate, layers, mouseTolerancePx: -1, zoom: ZOOM })).toThrow(
      RangeError,
    )
    expect(() =>
      resolveHit({
        coordinate,
        layers,
        pointer: 'touch',
        touchTolerancePx: Number.NaN,
        zoom: ZOOM,
      }),
    ).toThrow(RangeError)
  })
})

describe('point layer hit test through the resolver', () => {
  it('picks the nearest dot within tolerance', () => {
    const dots = dotsAt([
      { fractionX: 0.5, fractionY: 0.5 + 6 / 256, klass: 0 },
      { fractionX: 0.5, fractionY: 0.5 + 2 / 256, klass: 0 },
      { fractionX: 0.5, fractionY: 0.5 + 40 / 256, klass: 0 },
    ])
    const result = resolveHit({
      coordinate: coordinateAt(0.5, 0.5),
      layers: [{ kind: 'point', layer: dots }],
      zoom: ZOOM,
    })
    expect(result).toEqual({ hit: 1, kind: 'point' })
  })

  it('skips a hidden class (no style entry) and keeps no-data and not-reporting dots', () => {
    // Class 5 has no entry: hidden. It is the nearest dot, and is not returned.
    const dots = dotsAt([
      { fractionX: 0.5, fractionY: 0.5, klass: 5 },
      { fractionX: 0.5, fractionY: 0.5 + 4 / 256, klass: POINT_CLASS_NOT_REPORTING },
      { fractionX: 0.5, fractionY: 0.5 + 2 / 256, klass: POINT_CLASS_NO_DATA },
    ])
    const coordinate = coordinateAt(0.5, 0.5)
    const layers: HitLayer[] = [{ kind: 'point', layer: dots }]
    expect(resolveHit({ coordinate, layers, zoom: ZOOM })).toEqual({ hit: 2, kind: 'point' })

    // Only the hidden dot nearby: a miss, never index 0.
    const hiddenOnly = dotsAt([{ fractionX: 0.5, fractionY: 0.5, klass: 5 }])
    expect(
      resolveHit({ coordinate, layers: [{ kind: 'point', layer: hiddenOnly }], zoom: ZOOM }),
    ).toBeNull()
  })

  it('reaches a dot with touch that the mouse tolerance misses', () => {
    const dots = dotsAt([{ fractionX: 0.5, fractionY: 0.5 + 15 / 256, klass: 0 }])
    const coordinate = coordinateAt(0.5, 0.5)
    const layers: HitLayer[] = [{ kind: 'point', layer: dots }]
    expect(resolveHit({ coordinate, layers, pointer: 'mouse', zoom: ZOOM })).toBeNull()
    expect(resolveHit({ coordinate, layers, pointer: 'touch', zoom: ZOOM })).toEqual({
      hit: 0,
      kind: 'point',
    })
  })
})
