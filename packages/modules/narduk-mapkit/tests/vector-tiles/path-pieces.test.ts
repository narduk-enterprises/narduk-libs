import { describe, expect, it } from 'vitest'

import {
  buildDecodedVectorTile,
  collectVectorTilePathPieces,
  createVectorTileOverlaySource,
  pixelsPerMeter,
} from '../../src/client/index.js'

import { createFakeCanvas } from './fake-canvas.js'

import type { DecodedVectorTile, PointLayerView } from '../../src/client/index.js'
import type { FakeCanvas } from './fake-canvas.js'

/** The centre of tile z/x/y as a longitude and latitude. */
function centerOf(z: number, x: number, y: number) {
  const tiles = 2 ** z
  const longitude = ((x + 0.5) / tiles) * 360 - 180
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / tiles
  const latitude = (Math.atan(Math.sinh(n)) * 180) / Math.PI
  return { latitude, longitude }
}

function viewAt(z: number, x: number, y: number, size = 600): PointLayerView {
  return { ...centerOf(z, x, y), height: size, width: size, zoom: z }
}

const line = (...points: Array<[number, number]>) => points.map(([x, y]) => ({ x, y }))

describe('collectVectorTilePathPieces', () => {
  it('clips a line to its tile, drops the clip buffer, and keeps the direction', () => {
    // Stretch 7 runs west to east through the tile at y=1024, with a buffer either side.
    const tile = buildDecodedVectorTile(4096, [
      { lines: [line([-300, 1024], [4396, 1024])], properties: {}, si: 7 },
    ])
    const view = viewAt(12, 100, 200)
    const pieces = collectVectorTilePathPieces({
      stretches: [{ id: 7, meters: 1000 }],
      tileAt: (z, x, y) => (z === 12 && x === 100 && y === 200 ? tile : null),
      view,
      zoom: 12,
    })
    expect(pieces).toHaveLength(1)
    const [piece] = pieces
    expect(piece?.rank).toBe(0)
    expect(piece?.distanceM).toBe(0)
    const points = Array.from(piece?.points ?? [])
    expect(points).toHaveLength(4)
    // The tile is 256 px wide, centred on the view; y=1024 of 4096 is 64 px from its top.
    expect(points[0]).toBeCloseTo(300 - 128, 3)
    expect(points[2]).toBeCloseTo(300 + 128, 3)
    expect(points[1]).toBeCloseTo(300 - 128 + 64, 3)
    expect(points[3]).toBeCloseTo(300 - 128 + 64, 3)
  })

  it('splits a line that leaves and re-enters the tile into pieces', () => {
    const tile = buildDecodedVectorTile(4096, [
      {
        lines: [line([100, 100], [4300, 100], [4300, 900], [100, 900])],
        properties: {},
        si: 3,
      },
    ])
    const pieces = collectVectorTilePathPieces({
      stretches: [{ id: 3, meters: 400 }],
      tileAt: (_z, x, y) => (x === 10 && y === 10 ? tile : null),
      view: viewAt(8, 10, 10),
      zoom: 8,
    })
    // The line runs out of the east edge and back in: two pieces, the first one up to the edge.
    expect(pieces).toHaveLength(2)
    expect(pieces[0]?.distanceM).toBe(0)
    expect(pieces[1]?.distanceM).toBeGreaterThan(0)
    expect(pieces[1]?.distanceM).toBeLessThan(400)
  })

  it('orders pieces across tiles along the stretch, and stretches along the path', () => {
    // Stretch 5 crosses from tile x=100 to x=101; stretch 9 continues in x=101.
    const west = buildDecodedVectorTile(4096, [
      { lines: [line([2048, 2048], [4096, 2048])], properties: {}, si: 5 },
    ])
    const east = buildDecodedVectorTile(4096, [
      { lines: [line([0, 2048], [1024, 2048])], properties: {}, si: 5 },
      { lines: [line([1024, 2048], [4096, 2048])], properties: {}, si: 9 },
    ])
    const view = viewAt(12, 100, 200, 800)
    const pieces = collectVectorTilePathPieces({
      stretches: [
        { id: 5, meters: 3000 },
        { id: 9, meters: 1000 },
      ],
      tileAt: (_z, x, y) => (y !== 200 ? null : x === 100 ? west : x === 101 ? east : null),
      view,
      zoom: 12,
    })
    // The west piece is 128 px and the east 64: the east starts a third of the way along 3000 m.
    expect(pieces.map((piece) => [piece.rank, Math.round(piece.distanceM)])).toEqual([
      [0, 0],
      [0, 2000],
      [1, 3000],
    ])
    expect(pieces[0]?.points[0]).toBeLessThan(pieces[1]?.points[0] as number)
    // Contiguous: the west piece ends where the east piece begins.
    const westPoints = pieces[0]?.points as Float32Array
    expect(westPoints[2]).toBeCloseTo(pieces[1]?.points[0] as number, 2)
  })

  it('skips ids outside the path, tiles it lacks, and a tile with no si column', () => {
    const named = buildDecodedVectorTile(4096, [
      { lines: [line([0, 0], [4096, 4096])], properties: {}, si: 1 },
      { lines: [line([0, 4096], [4096, 0])], properties: {}, si: 2 },
    ])
    const bare: DecodedVectorTile = buildDecodedVectorTile(4096, [
      { lines: [line([0, 0], [4096, 4096])], properties: {} },
    ])
    const view = viewAt(10, 5, 5)
    const read = (tile: DecodedVectorTile | null) =>
      collectVectorTilePathPieces({
        stretches: [{ id: 2, meters: 10 }],
        tileAt: (_z, x, y) => (x === 5 && y === 5 ? tile : null),
        view,
        zoom: 10,
      })
    expect(read(named).map((piece) => piece.id)).toEqual([2])
    expect(read(bare)).toEqual([])
    expect(read(null)).toEqual([])
    expect(
      collectVectorTilePathPieces({ stretches: [], tileAt: () => named, view, zoom: 10 }),
    ).toEqual([])
  })

  it('measures ground metres in pixels at the view latitude', () => {
    const equator = pixelsPerMeter({ height: 100, latitude: 0, longitude: 0, width: 100, zoom: 10 })
    // 256 * 2^10 px round the world, 40,075,017 m round the equator.
    expect(equator).toBeCloseTo((256 * 1024) / 40_075_016.6856, 6)
    const north = pixelsPerMeter({ height: 100, latitude: 60, longitude: 0, width: 100, zoom: 10 })
    expect(north / equator).toBeCloseTo(2, 3)
  })
})

describe('VectorTileOverlaySource.pathPieces', () => {
  function setup() {
    const tile = buildDecodedVectorTile(4096, [
      { lines: [line([0, 2048], [4096, 2048])], properties: {}, si: 7 },
    ])
    return createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: async () => tile,
      maxDataZoom: 12,
      style: () => ({ color: '#2563eb', width: 1 }),
      tileBytes: async () => new Uint8Array([1]),
    })
  }

  it('reads only decoded tiles, at the zoom whose screenful is most complete', async () => {
    const overlay = setup()
    const view = viewAt(12, 100, 200, 200)
    const stretches = [{ id: 7, meters: 500 }]
    // Nothing decoded: nothing to draw, and nothing fetched on its behalf.
    expect(overlay.pathPieces({ stretches, view })).toEqual([])

    await overlay.imageForTile(100, 200, 12, 1)
    const pieces = overlay.pathPieces({ stretches, view, marginPx: 0 })
    expect(pieces).toHaveLength(1)
    expect(pieces[0]?.points[0]).toBeCloseTo(100 - 128, 3)

    // A view a little under zoom 12 still finds the z12 tiles (the nearest zoom with them).
    const between = overlay.pathPieces({ stretches, view: { ...view, zoom: 11.6 }, marginPx: 0 })
    expect(between).toHaveLength(1)
  })

  it('reads the deepest tiles for a view above the archive zoom', async () => {
    const overlay = setup()
    await overlay.imageForTile(100, 200, 12, 1)
    // Zoom 13.2 shows z12 tiles scaled up; the lines are 2^1.2 times as long on screen.
    const pieces = overlay.pathPieces({
      marginPx: 0,
      stretches: [{ id: 7, meters: 500 }],
      view: { ...viewAt(12, 100, 200, 200), zoom: 13.2 },
    })
    expect(pieces).toHaveLength(1)
    const points = pieces[0]?.points as Float32Array
    expect(points[2]! - points[0]!).toBeCloseTo(256 * 2 ** 1.2, 2)
  })
})
