// Sparse static layers: the finest zooms exist only where a finer source does (Narduk Geo fused depth).
import { describe, expect, it } from 'vitest'

import {
  FieldLayer,
  type FieldLayerOptions,
  parseCatalog,
  type TileId,
  type TileSource,
} from './geo'

const nothing: TileSource = { key: 'none', get: () => Promise.resolve(undefined) }
const img = { data: new Uint8Array(256 * 256 * 4), width: 256, height: 256 }

function layer(sparse: boolean): FieldLayer {
  const o: FieldLayerOptions = {
    mode: 'field',
    bbox: [-90, 20, -70, 30],
    minZoom: 0,
    maxZoom: 14,
    frames: [[{ bbox: [-90, 20, -70, 30], minZoom: 0, maxZoom: 14, source: nothing }]],
    sparse,
  }
  return new FieldLayer('t', o)
}

// The tile lookup is private: these tests drive it through its own entry table.
type Internals = {
  entries: Map<string, { frame: number; t: TileId; state: string; used: number; img?: typeof img }>
  queue: Array<{ frame: number; t: TileId }>
  key: (frame: number, t: TileId) => string
  resolve: (frame: number, t: TileId) => { entry: { t: TileId }; src: number[] } | null
  enqueueParent: (frame: number, t: TileId) => void
}
const inside = (l: FieldLayer) => l as unknown as Internals

function put(l: FieldLayer, t: TileId, state: 'empty' | 'ready' | 'loading' | 'error') {
  const i = inside(l)
  i.entries.set(i.key(0, t), {
    frame: 0,
    t,
    state,
    used: 0,
    img: state === 'ready' ? img : undefined,
  })
}

const z14: TileId = { z: 14, x: 4500, y: 7000 }
const z9: TileId = { z: 9, x: 4500 >> 5, y: 7000 >> 5 }

describe('sparse field layers', () => {
  it('reads the catalog flag on a static multi-archive layer', () => {
    const cat = parseCatalog(
      {
        schema: 'narduk-geo-catalog/v2',
        product: 'bathymetry',
        title: 'Depth',
        layers: [
          {
            id: 'depth',
            title: 'Depth',
            group: 'seafloor',
            kind: 'field',
            bbox: [-98, 7, -59, 31],
            minZoom: 0,
            maxZoom: 14,
            sparse: true,
            field: {
              encoding: 'terrarium',
              transform: 'log10',
              range: [-0.3, 3.8],
              ramp: [
                { value: -0.3, r: 1, g: 2, b: 3, a: 255 },
                { value: 3.8, r: 4, g: 5, b: 6, a: 255 },
              ],
            },
            archives: [
              { url: 'depth/base.pmtiles', minZoom: 0, maxZoom: 9, bbox: [-98, 7, -59, 31] },
              { url: 'depth/z10-a.pmtiles', minZoom: 10, maxZoom: 14, bbox: [-80, 22, -75, 27] },
            ],
          },
        ],
      },
      'https://tiles.example/geo/bathymetry/catalog.json',
    )
    const l = cat.layers[0]!
    expect(l.sparse).toBe(true)
    expect(l.frames[0]!.archives.map(a => [a.minZoom, a.maxZoom])).toEqual([
      [0, 9],
      [10, 14],
    ])
  })

  it('shows the nearest ancestor that exists in place of an absent tile', () => {
    const l = layer(true)
    put(l, z14, 'empty')
    for (let z = 13; z >= 10; z--) put(l, { z, x: 4500 >> (14 - z), y: 7000 >> (14 - z) }, 'empty')
    put(l, z9, 'ready')
    const r = inside(l).resolve(0, z14)!
    expect(r.entry.t).toEqual(z9)
    expect(r.src[2]).toBe(256 / 32) // a z14 tile is 1/32 of the z9 tile's width
  })

  it('without the flag an absent tile is no data, as before', () => {
    const l = layer(false)
    put(l, z14, 'empty')
    put(l, z9, 'ready')
    const r = inside(l).resolve(0, z14)!
    expect(r.entry.t).toEqual(z14)
    expect(r.src).toEqual([0, 0, 0])
  })

  it('asks for the first ancestor not yet requested, and none past one still pending', () => {
    const l = layer(true)
    put(l, z14, 'empty')
    put(l, { z: 13, x: 2250, y: 3500 }, 'empty')
    inside(l).enqueueParent(0, z14)
    expect(inside(l).queue.map(j => j.t)).toEqual([{ z: 12, x: 1125, y: 1750 }])
    // While that parent is on its way the tile is not yet known to be empty.
    expect(inside(l).resolve(0, z14)).toBeNull()
    put(l, { z: 12, x: 1125, y: 1750 }, 'loading')
    inside(l).queue.length = 0
    inside(l).enqueueParent(0, z14)
    expect(inside(l).queue).toEqual([])
  })

  it('is no data once every ancestor down to the layer minimum is absent', () => {
    const l = layer(true)
    put(l, z14, 'empty')
    for (let z = 13; z >= 8; z--) put(l, { z, x: 4500 >> (14 - z), y: 7000 >> (14 - z) }, 'empty')
    const r = inside(l).resolve(0, z14)!
    expect(r.src).toEqual([0, 0, 0])
  })

  it('retries an ancestor that failed rather than calling the tile empty', () => {
    const l = layer(true)
    put(l, z14, 'empty')
    put(l, { z: 13, x: 2250, y: 3500 }, 'error') // retryAt unset: due now
    expect(inside(l).resolve(0, z14)).toBeNull()
    inside(l).enqueueParent(0, z14)
    expect(inside(l).queue.map(j => j.t)).toEqual([{ z: 13, x: 2250, y: 3500 }])
  })
})
