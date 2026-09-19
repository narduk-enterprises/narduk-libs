import {
  buildDecodedVectorTile,
  createVectorTileOverlaySource,
  hitTestNeighbours,
  hitTestTile,
  projectToTilePoint,
} from '../src/client/index.js'

import type { DecodedVectorTile, VectorTileCanvas } from '../src/client/index.js'

const EXTENT = 4096

function tile(
  lines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
  properties: ReadonlyArray<Record<string, string>> = [],
): DecodedVectorTile {
  return buildDecodedVectorTile(
    EXTENT,
    lines.map((line, index) => ({ lines: [line], properties: properties[index] ?? {} })),
  )
}

describe('projectToTilePoint', () => {
  it('puts the prime meridian at the equator in the middle of the world', () => {
    const point = projectToTilePoint({ latitude: 0, longitude: 0 }, 1, 1)

    expect(point).toEqual({ tileX: 1, tileY: 1, x: 0, y: 0 })
  })

  it('wraps longitude, so 181 east is 179 west', () => {
    const east = projectToTilePoint({ latitude: 40, longitude: 181 }, 4, EXTENT)
    const west = projectToTilePoint({ latitude: 40, longitude: -179 }, 4, EXTENT)

    expect(east).toEqual(west)
  })

  it('clamps past the Mercator limit instead of returning infinity', () => {
    const north = projectToTilePoint({ latitude: 90, longitude: 0 }, 3, EXTENT)
    const south = projectToTilePoint({ latitude: -90, longitude: 0 }, 3, EXTENT)

    expect(Number.isFinite(north.y)).toBe(true)
    expect(Number.isFinite(south.y)).toBe(true)
    // The first and last rows of the pyramid, not one past either end.
    expect(north.tileY).toBe(0)
    expect(south.tileY).toBe(7)
  })

  it('places a known gauge in the tile that serves it', () => {
    // St. Paul, Minnesota on the Mississippi.
    const point = projectToTilePoint({ latitude: 44.9442, longitude: -93.0936 }, 7, EXTENT)

    expect({ tileX: point.tileX, tileY: point.tileY }).toEqual({ tileX: 30, tileY: 46 })
    expect(point.x).toBeGreaterThanOrEqual(0)
    expect(point.x).toBeLessThan(EXTENT)
  })
})

describe('hitTestTile', () => {
  const diagonal = tile([
    [
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
    ],
  ])

  it('finds the perpendicular distance to a segment, not to its ends', () => {
    // (500, 400) is 100/sqrt(2) from the line y = x, but 141 from (500,500).
    const hit = hitTestTile(diagonal, 500, 400, 200)

    expect(hit?.feature).toBe(0)
    expect(hit?.distance).toBeCloseTo(100 / Math.SQRT2, 6)
  })

  it('clamps to the segment rather than to its infinite line', () => {
    // Past the end of the diagonal: the nearest point is the endpoint itself.
    const hit = hitTestTile(diagonal, 1200, 1200, 400)

    expect(hit?.distance).toBeCloseTo(Math.hypot(200, 200), 6)
  })

  it('returns null when nothing is within tolerance', () => {
    expect(hitTestTile(diagonal, 3000, 0, 50)).toBeNull()
  })

  it('picks the nearer of two features', () => {
    const pair = tile(
      [
        [
          { x: 0, y: 100 },
          { x: 4000, y: 100 },
        ],
        [
          { x: 0, y: 300 },
          { x: 4000, y: 300 },
        ],
      ],
      [{ name: 'north' }, { name: 'south' }],
    )

    expect(hitTestTile(pair, 2000, 260, 500)?.feature).toBe(1)
    expect(hitTestTile(pair, 2000, 140, 500)?.feature).toBe(0)
  })

  it('reaches a probe outside the tile, which is how an edge is crossed', () => {
    const edge = tile([
      [
        { x: 10, y: 0 },
        { x: 10, y: 4000 },
      ],
    ])

    // Twenty units west of this tile's western edge.
    expect(hitTestTile(edge, -20, 2000, 50)?.distance).toBeCloseTo(30, 6)
  })

  it('handles a degenerate line whose points coincide', () => {
    const dot = buildDecodedVectorTile(EXTENT, [
      {
        lines: [
          [
            { x: 100, y: 100 },
            { x: 100, y: 100 },
          ],
        ],
        properties: {},
      },
    ])

    expect(hitTestTile(dot, 103, 104, 10)?.distance).toBeCloseTo(5, 6)
  })
})

describe('hitTestNeighbours', () => {
  const middle = { tileX: 4, tileY: 4, x: EXTENT / 2, y: EXTENT / 2 }

  it('consults one tile when the probe is nowhere near an edge', () => {
    expect(hitTestNeighbours(middle, 3, EXTENT, 100)).toHaveLength(1)
  })

  it('adds the diagonal when the probe is in a corner', () => {
    const corner = { tileX: 4, tileY: 4, x: 5, y: 5 }
    const found = hitTestNeighbours(corner, 3, EXTENT, 100)

    expect(found).toHaveLength(4)
    // The western neighbour sees the probe one full tile to its east.
    const west = found.find((entry) => entry.offsetX === 3 && entry.offsetY === 4)
    expect(west?.x).toBe(EXTENT + 5)
  })

  it('wraps across the antimeridian rather than dropping the tile', () => {
    const edge = { tileX: 0, tileY: 4, x: 2, y: EXTENT / 2 }
    const found = hitTestNeighbours(edge, 3, EXTENT, 100)

    expect(found.map((entry) => entry.offsetX).sort()).toEqual([0, 7])
  })

  it('does not invent a row above the first or below the last', () => {
    const top = hitTestNeighbours({ tileX: 4, tileY: 0, x: EXTENT / 2, y: 2 }, 3, EXTENT, 100)
    const bottom = hitTestNeighbours(
      { tileX: 4, tileY: 7, x: EXTENT / 2, y: EXTENT - 2 },
      3,
      EXTENT,
      100,
    )

    expect(top).toHaveLength(1)
    expect(bottom).toHaveLength(1)
  })
})

describe('the overlay source hit test', () => {
  function createSource(tiles: Record<string, DecodedVectorTile>) {
    const canvas = {
      height: 256,
      width: 256,
      getContext: () => ({
        lineCap: '',
        lineJoin: '',
        lineWidth: 0,
        strokeStyle: '',
        globalAlpha: 1,
        beginPath: () => {},
        clearRect: () => {},
        lineTo: () => {},
        moveTo: () => {},
        stroke: () => {},
      }),
    } satisfies VectorTileCanvas

    return createVectorTileOverlaySource({
      createCanvas: () => canvas,
      decode: (_bytes, address) =>
        Promise.resolve(tiles[`${address.z}/${address.x}/${address.y}`] ?? null),
      style: () => ({ color: '#000', width: 1 }),
      tileBytes: (z, x, y) => Promise.resolve(tiles[`${z}/${x}/${y}`] ? new Uint8Array([1]) : null),
      tileSize: 256,
    })
  }

  // A line straight down the middle of the tile that holds 0,0 at zoom 1.
  const middleTile = tile(
    [
      [
        { x: 0, y: 0 },
        { x: 0, y: EXTENT },
      ],
    ],
    [{ name: 'meridian' }],
  )

  it('misses when the tile has not been decoded yet, rather than fetching', () => {
    const source = createSource({ '1/1/1': middleTile })

    expect(source.hitTest({ coordinate: { latitude: 0, longitude: 0 }, zoom: 1 })).toBeNull()
    expect(source.size).toBe(0)
  })

  it('finds the feature under the probe once the tile is cached', async () => {
    const source = createSource({ '1/1/1': middleTile })
    await source.imageForTile(1, 1, 1, 1)

    const hit = source.hitTest({ coordinate: { latitude: 0, longitude: 0 }, zoom: 1 })

    expect(hit?.properties).toEqual({ name: 'meridian' })
    expect(hit?.tile).toEqual({ x: 1, y: 1, z: 1 })
    expect(hit?.distancePx).toBeCloseTo(0, 6)
  })

  it('reports distance in screen pixels, so tolerance means what it says', async () => {
    const source = createSource({ '1/1/1': middleTile })
    await source.imageForTile(1, 1, 1, 1)

    // One tile spans 256px at tileSize 256, and 180 degrees of longitude at
    // zoom 1, so a degree east of the line is well under a pixel... at the
    // equator a whole tile is 256px, so 16 extent units is one pixel.
    const near = source.hitTest({
      coordinate: { latitude: 0, longitude: 1 },
      tolerancePx: 8,
      zoom: 1,
    })
    expect(near?.distancePx).toBeGreaterThan(0)
    expect(near?.distancePx).toBeLessThan(8)

    const far = source.hitTest({
      coordinate: { latitude: 0, longitude: 20 },
      tolerancePx: 8,
      zoom: 1,
    })
    expect(far).toBeNull()
  })

  it('crosses a tile edge to reach geometry in the neighbour', async () => {
    // The line sits at the far eastern edge of the western tile; the probe is
    // just inside the eastern tile, which holds no geometry at all.
    const western = tile(
      [
        [
          { x: EXTENT, y: 0 },
          { x: EXTENT, y: EXTENT },
        ],
      ],
      [{ name: 'border river' }],
    )
    const source = createSource({ '1/0/1': western, '1/1/1': tile([]) })
    await source.imageForTile(0, 1, 1, 1)

    const hit = source.hitTest({
      coordinate: { latitude: 0, longitude: 0.5 },
      tolerancePx: 8,
      zoom: 1,
    })

    expect(hit?.properties).toEqual({ name: 'border river' })
    expect(hit?.tile.x).toBe(0)
  })

  it('stops answering after the archive is swapped', async () => {
    const source = createSource({ '1/1/1': middleTile })
    await source.imageForTile(1, 1, 1, 1)
    source.clearCache()

    expect(source.hitTest({ coordinate: { latitude: 0, longitude: 0 }, zoom: 1 })).toBeNull()
  })
})
