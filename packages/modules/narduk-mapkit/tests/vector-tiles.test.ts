import {
  buildDecodedVectorTile,
  createVectorTileOverlaySource,
  decodedVectorTileBytes,
  paintVectorTile,
  vectorTileFeatureCount,
} from '../src/client/index.js'

import type {
  DecodedVectorTile,
  VectorTileCanvas,
  VectorTileCanvasContext,
  VectorTileFeatureInput,
} from '../src/client/index.js'

type PaintCall =
  | { op: 'clearRect'; args: number[] }
  | { op: 'moveTo' | 'lineTo'; args: number[] }
  | { op: 'stroke'; strokeStyle: string; lineWidth: number; globalAlpha: number }

interface FakeCanvas extends VectorTileCanvas {
  calls: PaintCall[]
}

function createFakeCanvas(width: number, height: number): FakeCanvas {
  const calls: PaintCall[] = []
  const context: VectorTileCanvasContext = {
    globalAlpha: 1,
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    beginPath: () => {},
    clearRect: (...args) => calls.push({ op: 'clearRect', args }),
    lineTo: (...args) => calls.push({ op: 'lineTo', args }),
    moveTo: (...args) => calls.push({ op: 'moveTo', args }),
    stroke: () =>
      calls.push({
        op: 'stroke',
        globalAlpha: context.globalAlpha,
        lineWidth: context.lineWidth,
        strokeStyle: context.strokeStyle,
      }),
  }
  return { calls, height, width, getContext: () => context }
}

function tile(features: readonly VectorTileFeatureInput[]): DecodedVectorTile {
  return buildDecodedVectorTile(4096, features)
}

const twoReaches = tile([
  {
    lines: [
      [
        { x: 0, y: 0 },
        { x: 4096, y: 4096 },
      ],
    ],
    properties: { ri: 1, so: 5 },
  },
  {
    lines: [
      [
        { x: 0, y: 4096 },
        { x: 4096, y: 0 },
      ],
    ],
    properties: { ri: 2, so: 2 },
  },
])

describe('paintVectorTile', () => {
  it('maps tile coordinates onto the canvas at the device pixel ratio', () => {
    const canvas = createFakeCanvas(512, 512)

    const painted = paintVectorTile(canvas, twoReaches, {
      pixelRatio: 2,
      style: () => ({ color: '#0e7490', width: 1.5 }),
      tileSize: 256,
      zoom: 7,
    })

    expect(painted).toBe(true)
    expect(canvas.calls[0]).toEqual({ op: 'clearRect', args: [0, 0, 512, 512] })
    expect(canvas.calls[1]).toEqual({ op: 'moveTo', args: [0, 0] })
    expect(canvas.calls[2]).toEqual({ op: 'lineTo', args: [512, 512] })
    expect(canvas.calls[3]).toMatchObject({ op: 'stroke', lineWidth: 3, strokeStyle: '#0e7490' })
  })

  it('skips the features the style declines, so low orders can drop out', () => {
    const canvas = createFakeCanvas(256, 256)

    paintVectorTile(canvas, twoReaches, {
      pixelRatio: 1,
      style: (properties) => (Number(properties.so) >= 5 ? { color: '#fff', width: 1 } : null),
      tileSize: 256,
      zoom: 4,
    })

    expect(canvas.calls.filter((call) => call.op === 'stroke')).toHaveLength(1)
  })

  it('reports nothing painted when every feature is declined', () => {
    const canvas = createFakeCanvas(256, 256)

    expect(
      paintVectorTile(canvas, twoReaches, {
        pixelRatio: 1,
        style: () => null,
        tileSize: 256,
        zoom: 3,
      }),
    ).toBe(false)
  })
})

describe('createVectorTileOverlaySource', () => {
  function createSource(
    overrides: Partial<Parameters<typeof createVectorTileOverlaySource<FakeCanvas>>[0]> = {},
  ) {
    const fetched: string[] = []
    const decoded: string[] = []
    const source = createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: (_bytes, { x, y, z }) => {
        decoded.push(`${z}/${x}/${y}`)
        return Promise.resolve(twoReaches)
      },
      style: () => ({ color: '#0e7490', width: 1 }),
      tileBytes: (z, x, y) => {
        fetched.push(`${z}/${x}/${y}`)
        return Promise.resolve(new Uint8Array([1]))
      },
      ...overrides,
    })
    return { decoded, fetched, source }
  }

  it('returns a painted canvas sized for the requested scale', async () => {
    const { source } = createSource()

    const canvas = await source.imageForTile(31, 48, 7, 2)

    expect(canvas?.width).toBe(512)
    expect(canvas?.calls.some((call) => call.op === 'stroke')).toBe(true)
  })

  it('repaints a cached tile after a style change without refetching or re-decoding', async () => {
    const { decoded, fetched, source } = createSource()

    await source.imageForTile(31, 48, 7, 1)
    source.setStyle(() => ({ color: '#d2392b', width: 2 }))
    const canvas = await source.imageForTile(31, 48, 7, 1)

    expect(fetched).toEqual(['7/31/48'])
    expect(decoded).toEqual(['7/31/48'])
    expect(canvas?.calls.find((call) => call.op === 'stroke')).toMatchObject({
      lineWidth: 2,
      strokeStyle: '#d2392b',
    })
  })

  it('evicts the least recently used tile once the cache is full', async () => {
    const { fetched, source } = createSource({ cacheSize: 2 })

    await source.imageForTile(0, 0, 7, 1)
    await source.imageForTile(1, 0, 7, 1)
    await source.imageForTile(0, 0, 7, 1) // refreshes 7/0/0
    await source.imageForTile(2, 0, 7, 1) // evicts 7/1/0
    await source.imageForTile(1, 0, 7, 1)

    expect(source.size).toBe(2)
    expect(fetched).toEqual(['7/0/0', '7/1/0', '7/2/0', '7/1/0'])
  })

  it('draws nothing for a missing tile, an empty tile or a declined style', async () => {
    const missing = createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: () => Promise.resolve(twoReaches),
      style: () => ({ color: '#fff', width: 1 }),
      tileBytes: () => Promise.resolve(null),
    })
    const empty = createSource({ decode: () => Promise.resolve(tile([])) }).source
    const declined = createSource({ style: () => null }).source

    await expect(missing.imageForTile(0, 0, 7, 1)).resolves.toBeNull()
    await expect(empty.imageForTile(0, 0, 7, 1)).resolves.toBeNull()
    await expect(declined.imageForTile(0, 0, 7, 1)).resolves.toBeNull()
  })

  it('reports a decode failure and keeps the overlay alive', async () => {
    const failures: unknown[] = []
    const reason = new Error('bad protobuf')
    const { source } = createSource({
      decode: () => Promise.reject(reason),
      onError: (value) => failures.push(value),
    })

    await expect(source.imageForTile(0, 0, 7, 1)).resolves.toBeNull()
    expect(failures).toEqual([reason])
  })

  it('reads an address once when it is requested again mid-flight', async () => {
    // MapKit asks for a screenful at once and re-asks on every render pass,
    // so this is the ordinary case, not a race a test had to contrive.
    const fetched: string[] = []
    const decoded: string[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const source = createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: (_bytes, { x, y, z }) => {
        decoded.push(`${z}/${x}/${y}`)
        return Promise.resolve(twoReaches)
      },
      style: () => ({ color: '#0e7490', width: 1 }),
      tileBytes: async (z, x, y) => {
        fetched.push(`${z}/${x}/${y}`)
        await gate
        return new Uint8Array([1])
      },
    })

    const both = Promise.all([source.imageForTile(31, 48, 7, 1), source.imageForTile(31, 48, 7, 1)])
    release?.()
    const [first, second] = await both

    expect(fetched).toEqual(['7/31/48'])
    expect(decoded).toEqual(['7/31/48'])
    expect(first?.calls.some((call) => call.op === 'stroke')).toBe(true)
    expect(second?.calls.some((call) => call.op === 'stroke')).toBe(true)
    expect(source.size).toBe(1)
  })

  it('keeps a read started before clearCache out of the cleared cache', async () => {
    const fetched: string[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const source = createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: () => Promise.resolve(twoReaches),
      style: () => ({ color: '#0e7490', width: 1 }),
      tileBytes: async (z, x, y) => {
        fetched.push(`${z}/${x}/${y}`)
        await gate
        return new Uint8Array([1])
      },
    })

    const pending = source.imageForTile(31, 48, 7, 1)
    // The archive is replaced while the read is in the air. It cannot be
    // cancelled, so its result must not land under the old key.
    source.clearCache()
    release?.()
    await pending

    expect(source.size).toBe(0)
    await source.imageForTile(31, 48, 7, 1)
    expect(fetched).toEqual(['7/31/48', '7/31/48'])
  })

  it('clears the cache on demand', async () => {
    const { fetched, source } = createSource()

    await source.imageForTile(0, 0, 7, 1)
    source.clearCache()
    await source.imageForTile(0, 0, 7, 1)

    expect(source.size).toBe(1)
    expect(fetched).toEqual(['7/0/0', '7/0/0'])
  })
})

describe('buildDecodedVectorTile', () => {
  it('packs features into flat arrays a cache can afford to hold', () => {
    const packed = tile([
      {
        lines: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          [
            { x: 20, y: 20 },
            { x: 30, y: 30 },
            { x: 40, y: 40 },
          ],
        ],
        properties: { ri: 1 },
      },
      {
        lines: [
          [
            { x: 5, y: 5 },
            { x: 6, y: 6 },
          ],
        ],
        properties: { ri: 2 },
      },
    ])

    expect(vectorTileFeatureCount(packed)).toBe(2)
    expect(packed.featureLines).toEqual(new Uint32Array([0, 2, 3]))
    expect(packed.lineStarts).toEqual(new Uint32Array([0, 2, 5, 7]))
    expect([...packed.coordinates]).toEqual([0, 0, 10, 10, 20, 20, 30, 30, 40, 40, 5, 5, 6, 6])
    // 7 points at 4 bytes each; the object-per-point shape this replaced cost
    // roughly ten times that, which is what made a 256-tile cache unaffordable.
    expect(packed.coordinates.byteLength).toBe(28)
  })

  it('drops a line that cannot be stroked instead of leaving an empty range', () => {
    const packed = tile([
      {
        lines: [
          [{ x: 1, y: 1 }],
          [
            { x: 2, y: 2 },
            { x: 3, y: 3 },
          ],
        ],
        properties: { ri: 1 },
      },
    ])

    expect(packed.lineStarts).toEqual(new Uint32Array([0, 2]))
    expect([...packed.coordinates]).toEqual([2, 2, 3, 3])
  })

  it('clamps a wildly out-of-range point rather than wrapping it back across the tile', () => {
    const packed = tile([
      {
        lines: [
          [
            { x: 0, y: 0 },
            { x: 900_000, y: -900_000 },
          ],
        ],
        properties: { ri: 1 },
      },
    ])

    // Eight tile widths past the edge either way: off-canvas before and after.
    expect([...packed.coordinates]).toEqual([0, 0, 32_767, -32_768])
  })
})

describe('the decoded-tile memory budget', () => {
  it('reports the bytes a cache is holding, and releases them on eviction', async () => {
    const source = createVectorTileOverlaySource<FakeCanvas>({
      cacheSize: 2,
      createCanvas: createFakeCanvas,
      decode: () => Promise.resolve(twoReaches),
      style: () => ({ color: '#0e7490', width: 1 }),
      tileBytes: () => Promise.resolve(new Uint8Array([1])),
    })

    await source.imageForTile(0, 0, 7, 1)
    const oneTile = source.cacheBytes
    await source.imageForTile(1, 0, 7, 1)
    await source.imageForTile(2, 0, 7, 1)

    expect(oneTile).toBe(decodedVectorTileBytes(twoReaches))
    expect(source.size).toBe(2)
    expect(source.cacheBytes).toBe(oneTile * 2)

    source.clearCache()
    expect(source.cacheBytes).toBe(0)
  })

  it('counts the properties, which are what a dense archive actually grows', () => {
    const geometryOnly = buildDecodedVectorTile(4096, [
      {
        lines: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        ],
        properties: {},
      },
    ])
    const named = buildDecodedVectorTile(4096, [
      {
        lines: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        ],
        properties: { name: 'Brazos River' },
      },
    ])

    // Two points at 4 bytes, plus the two index arrays: nothing estimated.
    expect(decodedVectorTileBytes(geometryOnly)).toBe(8 + 8 + 8)
    // `name` adds the entry overhead plus two bytes per character, key and
    // value alike -- 32 + 8 + 24 -- which is the part a geometry-only count
    // would have hidden.
    expect(decodedVectorTileBytes(named)).toBe(24 + 32 + 8 + 24)
  })
})
