import { describe, expect, it, vi } from 'vitest'

import {
  buildDecodedVectorTile,
  createVectorTileAreaIndex,
  createVectorTileOverlaySource,
  paintVectorTileAreas,
  VectorTilePaintUnavailableError,
  vectorTileAreasReach,
} from '../../src/client/index.js'

import type {
  DecodedVectorTile,
  VectorTileAreaInput,
  VectorTileAreaLayer,
  VectorTileCanvas,
  VectorTileCanvasContext,
  VectorTilePainter,
  VectorTileRestyleHost,
} from '../../src/client/index.js'

type Call =
  | { op: 'moveTo' | 'lineTo'; args: number[] }
  | { op: 'closePath' | 'clearRect' }
  | { op: 'drawImage'; image: unknown }
  | { op: 'fill'; fillStyle: string; globalAlpha: number; rule: string | undefined }
  | { op: 'stroke'; strokeStyle: string; lineWidth: number; globalAlpha: number }

interface RecordingCanvas extends VectorTileCanvas {
  calls: Call[]
}

function recordingCanvas(width: number, height: number, canCompose = true): RecordingCanvas {
  const calls: Call[] = []
  const context: VectorTileCanvasContext = {
    globalAlpha: 1,
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    beginPath: () => {},
    clearRect: () => calls.push({ op: 'clearRect' }),
    closePath: () => calls.push({ op: 'closePath' }),
    fill: (rule) =>
      calls.push({
        op: 'fill',
        fillStyle: String(context.fillStyle),
        globalAlpha: context.globalAlpha,
        rule,
      }),
    fillStyle: '',
    lineTo: (...args) => calls.push({ op: 'lineTo', args }),
    moveTo: (...args) => calls.push({ op: 'moveTo', args }),
    stroke: () =>
      calls.push({
        op: 'stroke',
        globalAlpha: context.globalAlpha,
        lineWidth: context.lineWidth,
        strokeStyle: String(context.strokeStyle),
      }),
    ...(canCompose
      ? { drawImage: (image: unknown) => calls.push({ op: 'drawImage', image }) }
      : {}),
  }
  return { calls, height, width, getContext: () => context }
}

/** A square from (west, south) to (east, north), as GeoJSON. */
function square(west: number, south: number, east: number, north: number) {
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ]
}

function polygon(
  id: string,
  box: [number, number, number, number],
  extra: Partial<VectorTileAreaInput> = {},
): VectorTileAreaInput {
  return { geometry: { coordinates: square(...box), type: 'Polygon' }, id, ...extra }
}

const FILLED = { fillColor: '#2563eb', fillOpacity: 0.2, lineWidth: 2, strokeColor: '#1d4ed8' }

function layerOf(
  inputs: VectorTileAreaInput[],
  style: VectorTileAreaLayer['style'] = () => FILLED,
): VectorTileAreaLayer {
  return { index: createVectorTileAreaIndex(inputs), style }
}

describe('createVectorTileAreaIndex', () => {
  it('answers the most important area under a point, and every one', () => {
    const index = createVectorTileAreaIndex([
      polygon('watch', [-100, 30, -90, 40], { priority: 3 }),
      polygon('warning', [-96, 33, -94, 36], { priority: 4 }),
      polygon('statement', [-120, 30, -110, 40], { priority: 1 }),
    ])

    expect(index.hitTest({ latitude: 34, longitude: -95 })?.id).toBe('warning')
    expect(index.hitTestAll({ latitude: 34, longitude: -95 }).map((area) => area.id)).toEqual([
      'warning',
      'watch',
    ])
    expect(index.hitTest({ latitude: 31, longitude: -99 })?.id).toBe('watch')
    expect(index.hitTest({ latitude: 20, longitude: -99 })).toBeNull()
  })

  it('puts the area given earlier first among equal priorities', () => {
    const index = createVectorTileAreaIndex([
      polygon('first', [-100, 30, -90, 40]),
      polygon('second', [-100, 30, -90, 40]),
    ])

    expect(index.areas.map((area) => area.id)).toEqual(['first', 'second'])
    expect(index.hitTest({ latitude: 35, longitude: -95 })?.id).toBe('first')
  })

  it('treats a hole as outside and a MultiPolygon as one area', () => {
    const outer = square(-100, 30, -90, 40)[0]!
    const hole = [
      [-96, 34],
      [-94, 34],
      [-94, 36],
      [-96, 36],
      [-96, 34],
    ]
    const index = createVectorTileAreaIndex([
      { geometry: { coordinates: [outer, hole], type: 'Polygon' }, id: 'donut' },
      {
        geometry: {
          coordinates: [square(-80, 30, -78, 32), square(-70, 30, -68, 32)],
          type: 'MultiPolygon',
        },
        id: 'pair',
      },
    ])

    expect(index.hitTest({ latitude: 35, longitude: -95 })).toBeNull()
    expect(index.hitTest({ latitude: 31, longitude: -99 })?.id).toBe('donut')
    expect(index.hitTest({ latitude: 31, longitude: -79 })?.id).toBe('pair')
    expect(index.hitTest({ latitude: 31, longitude: -69 })?.id).toBe('pair')
    expect(index.get('pair')?.shapes).toHaveLength(2)
  })

  it('lists an input with no readable shape as skipped, never drawn or hit', () => {
    const index = createVectorTileAreaIndex([
      { geometry: null, id: 'none' },
      { geometry: { coordinates: [], type: 'Polygon' }, id: 'empty' },
      { geometry: { coordinates: [1, 2], type: 'Point' }, id: 'point' },
      polygon('real', [-100, 30, -90, 40]),
    ])

    expect(index.skipped).toEqual(['none', 'empty', 'point'])
    expect(index.areas.map((area) => area.id)).toEqual(['real'])
    expect(index.get('none')).toBeUndefined()
  })

  it('reports the box of an area in degrees, covering every polygon', () => {
    const index = createVectorTileAreaIndex([
      {
        geometry: {
          coordinates: [square(-80, 30, -78, 32), square(-70, 35, -68, 36)],
          type: 'MultiPolygon',
        },
        id: 'pair',
      },
    ])

    const [west, south, east, north] = index.boundsOf('pair')!
    expect(west).toBeCloseTo(-80, 6)
    expect(east).toBeCloseTo(-68, 6)
    expect(south).toBeCloseTo(30, 6)
    expect(north).toBeCloseTo(36, 6)
    expect(index.boundsOf('absent')).toBeNull()
  })

  it('lets a caller refuse areas before the choice', () => {
    const index = createVectorTileAreaIndex([
      polygon('hidden', [-100, 30, -90, 40], { priority: 9 }),
      polygon('shown', [-100, 30, -90, 40], { priority: 1 }),
    ])

    expect(
      index.hitTest({ latitude: 35, longitude: -95 }, (area) => area.id !== 'hidden')?.id,
    ).toBe('shown')
  })
})

describe('paintVectorTileAreas', () => {
  it('projects a shape into the tile it covers, filled even-odd, then outlined', () => {
    // Tile 0/0/0 is the world: lng 0 is x=128 and lat 0 is y=128 on a 256 tile.
    const canvas = recordingCanvas(256, 256)
    const layer = layerOf([polygon('a', [0, -10, 10, 0])])

    const painted = paintVectorTileAreas(canvas, layer, {
      pixelRatio: 1,
      tile: { x: 0, y: 0, z: 0 },
      tileSize: 256,
    })

    expect(painted).toBe(true)
    const first = canvas.calls[0]
    expect(first).toMatchObject({ op: 'moveTo' })
    const [x0, y0] = (first as { args: number[] }).args
    expect(x0).toBeCloseTo(128, 6)
    // lat -10 is just below the equator line at 128.
    expect(y0).toBeGreaterThan(128)
    expect(canvas.calls.map((call) => call.op)).toEqual([
      'moveTo',
      'lineTo',
      'lineTo',
      'lineTo',
      'lineTo',
      'closePath',
      'fill',
      'stroke',
    ])
    expect(canvas.calls.find((call) => call.op === 'fill')).toMatchObject({
      fillStyle: '#2563eb',
      globalAlpha: 0.2,
      rule: 'evenodd',
    })
    expect(canvas.calls.find((call) => call.op === 'stroke')).toMatchObject({
      globalAlpha: 1,
      lineWidth: 2,
      strokeStyle: '#1d4ed8',
    })
  })

  it('scales the outline by the device pixel ratio and maps a deeper tile into its own pixels', () => {
    const canvas = recordingCanvas(512, 512)
    const layer = layerOf([polygon('a', [0, -10, 10, 0])])

    // Tile 1/1/0 is the north-east quarter: lng 0 is its left edge.
    paintVectorTileAreas(canvas, layer, {
      pixelRatio: 2,
      tile: { x: 1, y: 0, z: 1 },
      tileSize: 256,
    })

    const [x0] = (canvas.calls[0] as { args: number[] }).args
    expect(x0).toBeCloseTo(0, 6)
    expect(canvas.calls.find((call) => call.op === 'stroke')).toMatchObject({ lineWidth: 4 })
  })

  it('paints the most important area last, so it sits on top', () => {
    const canvas = recordingCanvas(256, 256)
    const colours: Record<string, string> = { low: '#111111', high: '#222222' }
    const layer = layerOf(
      [
        polygon('high', [0, -10, 10, 0], { priority: 2 }),
        polygon('low', [0, -10, 10, 0], { priority: 1 }),
      ],
      (area) => ({ fillColor: colours[area.id] ?? '#000000' }),
    )

    paintVectorTileAreas(canvas, layer, {
      pixelRatio: 1,
      tile: { x: 0, y: 0, z: 0 },
      tileSize: 256,
    })

    expect(
      canvas.calls
        .filter((call) => call.op === 'fill')
        .map((call) => (call as { fillStyle: string }).fillStyle),
    ).toEqual(['#111111', '#222222'])
  })

  it('draws an outline only, a fill only, and nothing for an area the style declines', () => {
    const outline = recordingCanvas(256, 256)
    const fill = recordingCanvas(256, 256)
    const none = recordingCanvas(256, 256)
    const input = [polygon('a', [0, -10, 10, 0])]
    const at = { pixelRatio: 1, tile: { x: 0, y: 0, z: 0 }, tileSize: 256 }

    paintVectorTileAreas(
      outline,
      layerOf(input, () => ({ strokeColor: '#000000' })),
      at,
    )
    paintVectorTileAreas(
      fill,
      layerOf(input, () => ({ fillColor: '#000000' })),
      at,
    )
    const painted = paintVectorTileAreas(
      none,
      layerOf(input, () => null),
      at,
    )

    expect(outline.calls.map((call) => call.op)).not.toContain('fill')
    expect(outline.calls.map((call) => call.op)).toContain('stroke')
    expect(fill.calls.map((call) => call.op)).toContain('fill')
    expect(fill.calls.map((call) => call.op)).not.toContain('stroke')
    expect(painted).toBe(false)
    expect(none.calls).toEqual([])
  })

  it('leaves a tile an area does not reach alone', () => {
    const canvas = recordingCanvas(256, 256)
    const layer = layerOf([polygon('a', [0, -10, 10, 0])])
    // 4/0/0 is far north-west of a small box at the equator.
    const far = { x: 0, y: 0, z: 4 }

    expect(vectorTileAreasReach(layer, far, 256)).toBe(false)
    expect(vectorTileAreasReach(layer, { x: 8, y: 8, z: 4 }, 256)).toBe(true)
    expect(paintVectorTileAreas(canvas, layer, { pixelRatio: 1, tile: far, tileSize: 256 })).toBe(
      false,
    )
    expect(canvas.calls).toEqual([])
  })

  it('draws nothing on a canvas that cannot fill', () => {
    const bare: VectorTileCanvas = {
      height: 256,
      width: 256,
      getContext: () => ({
        globalAlpha: 1,
        lineCap: '',
        lineJoin: '',
        lineWidth: 0,
        strokeStyle: '',
        beginPath: () => {},
        clearRect: () => {},
        lineTo: () => {},
        moveTo: () => {},
        stroke: () => {},
      }),
    }

    expect(
      paintVectorTileAreas(bare, layerOf([polygon('a', [0, -10, 10, 0])]), {
        pixelRatio: 1,
        tile: { x: 0, y: 0, z: 0 },
        tileSize: 256,
      }),
    ).toBe(false)
  })
})

/** One river across the middle of every tile. */
function river(): DecodedVectorTile {
  return buildDecodedVectorTile(4096, [
    {
      lines: [
        [
          { x: 0, y: 2048 },
          { x: 4096, y: 2048 },
        ],
      ],
      properties: { si: 1, so: 5 },
    },
  ])
}

function setup(
  options: {
    painter?: VectorTilePainter<RecordingCanvas>
    tile?: DecodedVectorTile | null
  } = {},
) {
  const created: RecordingCanvas[] = []
  const source = createVectorTileOverlaySource<RecordingCanvas>({
    createCanvas: (width, height) => {
      const canvas = recordingCanvas(width, height)
      created.push(canvas)
      return canvas
    },
    decode: async () => (options.tile === undefined ? river() : options.tile),
    maxDataZoom: 12,
    ...(options.painter ? { painter: options.painter } : {}),
    style: () => ({ color: '#0e7490', width: 1 }),
    tileBytes: async () => new Uint8Array([1]),
  })
  return { created, source }
}

const OVER_THE_EQUATOR = [polygon('alert', [-10, -10, 10, 10], { data: { name: 'Flood warning' } })]

describe('areas in the overlay', () => {
  it('paints the areas into the tile image first and the lines over them', async () => {
    const { created, source } = setup()
    await source.setAreas(layerOf(OVER_THE_EQUATOR))

    const canvas = await source.imageForTile(0, 0, 0, 1)

    expect(canvas).toBe(created[0])
    const ops = canvas!.calls.map((call) => call.op)
    expect(ops.indexOf('fill')).toBeGreaterThan(-1)
    // The clear comes first, then the area fill and outline, then the river's stroke.
    expect(ops[0]).toBe('clearRect')
    const lines = canvas!.calls.filter((call) => call.op === 'stroke')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ strokeStyle: '#1d4ed8' })
    expect(lines[1]).toMatchObject({ strokeStyle: '#0e7490' })
    expect(ops.indexOf('fill')).toBeLessThan(ops.indexOf('stroke'))
  })

  it('paints a tile no area reaches exactly as it was', async () => {
    const { source } = setup()
    await source.setAreas(layerOf(OVER_THE_EQUATOR))

    // Zoom 6, far north of the alert.
    const canvas = await source.imageForTile(0, 0, 6, 1)

    expect(canvas!.calls.map((call) => call.op)).not.toContain('fill')
    expect(canvas!.calls.filter((call) => call.op === 'stroke')).toHaveLength(1)
  })

  it('draws the areas of a tile the archive holds no lines for', async () => {
    const { source } = setup({ tile: null })
    expect(await source.imageForTile(0, 0, 0, 1)).toBeNull()

    await source.setAreas(layerOf(OVER_THE_EQUATOR))
    const canvas = await source.imageForTile(0, 0, 0, 1)

    expect(canvas!.calls.map((call) => call.op)).toContain('fill')
    expect(canvas!.calls.filter((call) => call.op === 'stroke')).toHaveLength(1)
  })

  it("composes the painter's lines over the areas on a tile an area reaches", async () => {
    const lines = recordingCanvas(256, 256)
    const painter: VectorTilePainter<RecordingCanvas> = { paint: vi.fn(async () => lines) }
    const { created, source } = setup({ painter })
    await source.setAreas(layerOf(OVER_THE_EQUATOR))

    const canvas = await source.imageForTile(0, 0, 0, 1)

    expect(canvas).toBe(created[0])
    expect(canvas).not.toBe(lines)
    const ops = canvas!.calls.map((call) => call.op)
    expect(ops.indexOf('fill')).toBeLessThan(ops.indexOf('drawImage'))
    expect(canvas!.calls.find((call) => call.op === 'drawImage')).toMatchObject({ image: lines })
    expect(painter.paint).toHaveBeenCalledTimes(1)
  })

  it("hands back the painter's image untouched when no area reaches the tile", async () => {
    const lines = recordingCanvas(256, 256)
    const painter: VectorTilePainter<RecordingCanvas> = { paint: vi.fn(async () => lines) }
    const { created, source } = setup({ painter })
    await source.setAreas(layerOf(OVER_THE_EQUATOR))

    expect(await source.imageForTile(0, 0, 6, 1)).toBe(lines)
    expect(created).toHaveLength(0)
  })

  it('paints the whole tile here when the painter declines it', async () => {
    const painter: VectorTilePainter<RecordingCanvas> = {
      paint: async () => {
        throw new VectorTilePaintUnavailableError('no OffscreenCanvas')
      },
    }
    const { source } = setup({ painter })
    await source.setAreas(layerOf(OVER_THE_EQUATOR))

    const canvas = await source.imageForTile(0, 0, 0, 1)

    expect(canvas!.calls.map((call) => call.op)).toContain('fill')
    expect(canvas!.calls.filter((call) => call.op === 'stroke')).toHaveLength(2)
  })

  it('swaps the overlay through the restyle host when the areas change', async () => {
    const replace = vi.fn(async (_id: string) => {})
    const host: VectorTileRestyleHost<RecordingCanvas> = { layerId: 'network', replace }
    const { source } = setup()
    source.setRestyleHost(host)

    await source.setAreas(layerOf(OVER_THE_EQUATOR))
    await source.setAreas(null)

    expect(replace).toHaveBeenCalledTimes(2)
    expect(replace.mock.calls[0]?.[0]).toBe('network')
    expect(source.areas).toBeNull()
  })

  it('answers the drawn area under a point, and only a drawn one', async () => {
    const { source } = setup()
    let showing: ReadonlySet<string> = new Set(['alert'])
    const layer = layerOf(
      [...OVER_THE_EQUATOR, polygon('hidden', [-10, -10, 10, 10], { priority: 5 })],
      (area) => (showing.has(area.id) ? FILLED : null),
    )
    await source.setAreas(layer)

    const point = { latitude: 1, longitude: 1 }
    expect(source.hitTestArea<{ name: string }>(point)?.data?.name).toBe('Flood warning')
    expect(source.hitTestAreas(point).map((area) => area.id)).toEqual(['alert'])

    showing = new Set()
    expect(source.hitTestArea(point)).toBeNull()
    await source.setAreas(null)
    expect(source.hitTestArea(point)).toBeNull()
  })
})
