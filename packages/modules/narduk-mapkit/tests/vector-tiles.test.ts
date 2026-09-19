import { createVectorTileOverlaySource, paintVectorTile } from '../src/client/index.js'

import type {
  DecodedVectorTile,
  VectorTileCanvas,
  VectorTileCanvasContext,
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

function tile(features: DecodedVectorTile['features']): DecodedVectorTile {
  return { extent: 4096, features }
}

const twoReaches = tile([
  {
    geometry: [
      [
        { x: 0, y: 0 },
        { x: 4096, y: 4096 },
      ],
    ],
    properties: { ri: 1, so: 5 },
  },
  {
    geometry: [
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

  it('clears the cache on demand', async () => {
    const { fetched, source } = createSource()

    await source.imageForTile(0, 0, 7, 1)
    source.clearCache()
    await source.imageForTile(0, 0, 7, 1)

    expect(source.size).toBe(1)
    expect(fetched).toEqual(['7/0/0', '7/0/0'])
  })
})
