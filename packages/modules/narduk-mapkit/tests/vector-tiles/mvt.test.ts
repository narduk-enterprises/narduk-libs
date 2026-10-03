import { vectorTileFeatureCount } from '../../src/client/index.js'
import {
  createMvtDecoder,
  decodeMvtTile,
  smoothCoarseNetwork,
} from '../../src/vector-tiles/index.js'

import { encodeVectorTile } from './fixture.js'

import type { DecodedVectorTile } from '../../src/client/index.js'

const address = { x: 31, y: 48, z: 7 }

/** Read a decoded feature back as points, which is what an assertion reads. */
function lineOf(tile: DecodedVectorTile, feature: number, line = 0) {
  const lineIndex = (tile.featureLines[feature] ?? 0) + line
  const start = tile.lineStarts[lineIndex] ?? 0
  const end = tile.lineStarts[lineIndex + 1] ?? start
  const points: Array<{ x: number; y: number }> = []
  for (let point = start; point < end; point += 1) {
    points.push({ x: tile.coordinates[point * 2] ?? 0, y: tile.coordinates[point * 2 + 1] ?? 0 })
  }
  return points
}

describe('createMvtDecoder', () => {
  it('walks the zigzag-delta geometry back into tile coordinates', async () => {
    const bytes = encodeVectorTile([
      {
        features: [
          {
            lines: [
              [
                { x: 10, y: 20 },
                { x: 40, y: 20 },
                { x: 40, y: 90 },
              ],
            ],
            properties: { name: 'Brazos River', ri: 7, so: 5 },
            type: 2,
          },
        ],
        name: 'reaches',
      },
    ])

    const tile = await createMvtDecoder()(bytes, address)

    expect(tile).not.toBeNull()
    expect(tile?.extent).toBe(4096)
    expect(vectorTileFeatureCount(tile as DecodedVectorTile)).toBe(1)
    expect(lineOf(tile as DecodedVectorTile, 0)).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 90 },
    ])
    expect(tile?.properties[0]).toEqual({ name: 'Brazos River', ri: 7, so: 5 })
  })

  it('keeps each line of a multi-line feature separate', async () => {
    const bytes = encodeVectorTile([
      {
        features: [
          {
            lines: [
              [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
              ],
              [
                { x: 200, y: 200 },
                { x: 300, y: 200 },
                { x: 300, y: 400 },
              ],
            ],
            properties: { ri: 1 },
            type: 2,
          },
        ],
        name: 'reaches',
      },
    ])

    const tile = (await createMvtDecoder()(bytes, address)) as DecodedVectorTile

    expect(tile.featureLines).toEqual(new Uint32Array([0, 2]))
    expect(tile.lineStarts).toEqual(new Uint32Array([0, 2, 5]))
    expect(lineOf(tile, 0, 1)).toEqual([
      { x: 200, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 400 },
    ])
  })

  it('reads only the named layers', async () => {
    const bytes = encodeVectorTile([
      {
        features: [
          {
            lines: [
              [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
              ],
            ],
            properties: { ri: 1 },
            type: 2,
          },
        ],
        name: 'reaches',
      },
      {
        features: [
          {
            lines: [
              [
                { x: 5, y: 5 },
                { x: 15, y: 15 },
              ],
            ],
            properties: { label: 'Waco' },
            type: 2,
          },
        ],
        name: 'labels',
      },
    ])

    const all = (await createMvtDecoder()(bytes, address)) as DecodedVectorTile
    const reaches = (await createMvtDecoder({ layers: ['reaches'] })(
      bytes,
      address,
    )) as DecodedVectorTile

    expect(vectorTileFeatureCount(all)).toBe(2)
    expect(vectorTileFeatureCount(reaches)).toBe(1)
    expect(reaches.properties[0]).toEqual({ ri: 1 })
  })

  it('keeps only the named properties, which is what bounds the cache', async () => {
    const bytes = encodeVectorTile([
      {
        features: [
          {
            lines: [
              [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
              ],
            ],
            properties: { name: 'a long river name', ri: 42, so: 4 },
            type: 2,
          },
        ],
        name: 'reaches',
      },
    ])

    const tile = (await createMvtDecoder({ properties: ['ri', 'so'] })(
      bytes,
      address,
    )) as DecodedVectorTile

    expect(tile.properties[0]).toEqual({ ri: 42, so: 4 })
  })

  it('scales a layer onto the largest extent in the tile', () => {
    const bytes = encodeVectorTile([
      {
        extent: 4096,
        features: [
          {
            lines: [
              [
                { x: 0, y: 0 },
                { x: 4096, y: 0 },
              ],
            ],
            type: 2,
          },
        ],
        name: 'reaches',
      },
      {
        extent: 2048,
        features: [
          {
            lines: [
              [
                { x: 0, y: 0 },
                { x: 1024, y: 0 },
              ],
            ],
            type: 2,
          },
        ],
        name: 'coarse',
      },
    ])

    const tile = decodeMvtTile(bytes) as DecodedVectorTile

    expect(tile.extent).toBe(4096)
    // Half of the coarse layer's 2048-wide space is half of 4096 too.
    expect(lineOf(tile, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 2048, y: 0 },
    ])
  })

  it('drops point features, which cannot be stroked', () => {
    const bytes = encodeVectorTile([
      {
        features: [
          { lines: [[{ x: 100, y: 100 }]], properties: { kind: 'gauge' }, type: 1 },
          {
            lines: [
              [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
              ],
            ],
            properties: { ri: 1 },
            type: 2,
          },
        ],
        name: 'mixed',
      },
    ])

    const tile = decodeMvtTile(bytes) as DecodedVectorTile

    // The point still occupies a feature slot; it simply owns no lines.
    expect(tile.featureLines).toEqual(new Uint32Array([0, 0, 1]))
    expect(lineOf(tile, 1)).toHaveLength(2)
  })

  it('decodes an empty tile to null rather than reporting a failure', () => {
    expect(decodeMvtTile(new Uint8Array(0))).toBeNull()
    expect(decodeMvtTile(encodeVectorTile([]))).toBeNull()
    expect(decodeMvtTile(encodeVectorTile([{ features: [], name: 'reaches' }]))).toBeNull()
  })

  it('decodes to null when no named layer is present', () => {
    const bytes = encodeVectorTile([
      {
        features: [
          {
            lines: [
              [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
            ],
            type: 2,
          },
        ],
        name: 'labels',
      },
    ])

    expect(decodeMvtTile(bytes, { layers: ['reaches'] })).toBeNull()
  })

  it('rejects bytes that are not a tile at all, so they get counted', async () => {
    // An HTML error page served with a 200, or a truncated read: drawing
    // blank country over it would hide the mistake. `rejects` rather than
    // `toThrow` on purpose -- the decoder must not throw at its caller.
    const notATile = new TextEncoder().encode('<!doctype html><title>404</title>')

    await expect(createMvtDecoder()(notATile, address)).rejects.toThrow('not a vector tile')
    expect(() => decodeMvtTile(new Uint8Array([0x08, 0x01, 0x10, 0x02]))).toThrow(
      'not a vector tile',
    )
  })
})

describe('coarse-grid tiles', () => {
  // A low-zoom tile on a 512 grid, as river-network v3 builds z0-3 (z4 is 256):
  // a gentle diagonal quantised into unit steps, each step its own two-point
  // line, which is how v3 stores it.
  const staircase = [
    { x: 100, y: 100 },
    { x: 101, y: 100 },
    { x: 101, y: 101 },
    { x: 102, y: 101 },
    { x: 102, y: 102 },
    { x: 103, y: 102 },
    { x: 103, y: 103 },
    { x: 104, y: 103 },
    { x: 104, y: 104 },
  ]
  const steps = staircase.slice(1).map((point, index) => [[staircase[index]!, point]])

  /** Perpendicular distance from the diagonal y = x. */
  const offDiagonal = (point: { x: number; y: number }) => Math.abs(point.x - point.y) / Math.SQRT2

  it('straightens a staircase stored as separate two-point lines', () => {
    const smoothed = smoothCoarseNetwork(steps)
    const points = smoothed.flatMap((lines) => lines.flat())
    // The ends of the run stay put.
    expect(smoothed[0]?.[0]?.[0]).toEqual({ x: 100, y: 100 })
    expect(smoothed.at(-1)?.[0]?.at(-1)).toEqual({ x: 104, y: 104 })
    // The corners sat 0.707 off the diagonal; the interior is now a straight
    // line well inside half of that.
    const interior = points.filter(
      (point) => !(point.x === 100 && point.y === 100) && !(point.x === 104 && point.y === 104),
    )
    for (const point of interior) expect(offDiagonal(point)).toBeLessThan(0.36)
    // And every shared point moved as one: each step still meets the next.
    for (let index = 0; index + 1 < smoothed.length; index += 1) {
      expect(smoothed[index]?.[0]?.at(-1)).toEqual(smoothed[index + 1]?.[0]?.[0])
    }
  })

  it('leaves a junction and a line end exactly where they were', () => {
    const junction = { x: 10, y: 10 }
    const smoothed = smoothCoarseNetwork([
      [[{ x: 0, y: 10 }, junction]],
      [[junction, { x: 20, y: 10 }]],
      [[junction, { x: 10, y: 0 }]],
    ])
    expect(smoothed[0]?.[0]).toEqual([{ x: 0, y: 10 }, junction])
    expect(smoothed[1]?.[0]).toEqual([junction, { x: 20, y: 10 }])
    expect(smoothed[2]?.[0]).toEqual([junction, { x: 10, y: 0 }])
  })

  it('decodes a 512-extent tile onto a 4096 grid with the staircase smoothed', () => {
    const bytes = encodeVectorTile([
      {
        extent: 512,
        features: steps.map((lines) => ({ lines, type: 2 })),
        name: 'rivers',
      },
    ])
    const tile = decodeMvtTile(bytes) as DecodedVectorTile

    expect(tile.extent).toBe(4096)
    expect(lineOf(tile, 0)[0]).toEqual({ x: 800, y: 800 })
    expect(lineOf(tile, steps.length - 1).at(-1)).toEqual({ x: 832, y: 832 })
    // No staircase corner survives (8 units off the diagonal at this scale).
    for (let feature = 1; feature < steps.length - 1; feature += 1) {
      for (const point of lineOf(tile, feature)) expect(offDiagonal(point)).toBeLessThan(3)
    }
  })

  it('leaves a 4096-extent tile exactly as encoded', () => {
    const bytes = encodeVectorTile([
      { extent: 4096, features: [{ lines: [staircase], type: 2 }], name: 'rivers' },
    ])
    expect(lineOf(decodeMvtTile(bytes) as DecodedVectorTile, 0)).toEqual(staircase)
  })
})
