import { describe, expect, it } from 'vitest'

import { createAreaMaskTileSource, createVectorTileAreaIndex } from '../src/client/index.js'

import type { VectorTileCanvas, VectorTileCanvasContext } from '../src/client/index.js'

type Op = [string, ...number[]]

interface MaskCanvas extends VectorTileCanvas {
  fills: Array<{ rule: string | undefined; fillStyle: string; alpha: number; moves: number }>
  ops: Op[]
  strokes: Array<{ alpha: number; lineWidth: number; strokeStyle: string; moves: number }>
}

function createCanvas(width: number, height: number): MaskCanvas {
  const ops: Op[] = []
  const fills: MaskCanvas['fills'] = []
  const strokes: MaskCanvas['strokes'] = []
  let moves = 0
  const context = {
    beginPath: () => {
      moves = 0
      ops.push(['begin'])
    },
    closePath: () => ops.push(['close']),
    fill: (rule?: string) =>
      fills.push({
        alpha: context.globalAlpha,
        fillStyle: String(context.fillStyle),
        moves,
        rule,
      }),
    fillStyle: '',
    globalAlpha: 1,
    lineCap: '',
    lineJoin: '',
    lineTo: (x: number, y: number) => ops.push(['line', x, y]),
    lineWidth: 0,
    moveTo: (x: number, y: number) => {
      moves += 1
      ops.push(['move', x, y])
    },
    stroke: () =>
      strokes.push({
        alpha: context.globalAlpha,
        lineWidth: context.lineWidth,
        moves,
        strokeStyle: String(context.strokeStyle),
      }),
    strokeStyle: '',
  } as unknown as VectorTileCanvasContext
  return { fills, getContext: () => context, height, ops, strokes, width }
}

const square = (west: number, south: number, east: number, north: number) => ({
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
  type: 'Polygon',
})

/** Ohio-ish, and a second state east of it. */
const index = createVectorTileAreaIndex([
  { geometry: square(-85, 38, -80, 42), id: 'OH' },
  { geometry: square(-80, 38, -75, 42), id: 'PA' },
])
const COVER = '#eef0ec'
/** The z4 tile that holds -82.5, 40; one far to the west holds nothing. */
const ON = { x: 4, y: 6, z: 4 }
const OFF = { x: 0, y: 6, z: 4 }

describe('createAreaMaskTileSource', () => {
  it('covers the tile and cuts the areas out with one even-odd fill', async () => {
    const source = createAreaMaskTileSource({
      createCanvas,
      layer: { fillColor: COVER, ids: ['OH'], index },
    })
    const canvas = await source.imageForTile(ON.x, ON.y, ON.z, 2)
    expect(canvas?.width).toBe(512)
    expect(canvas?.fills).toEqual([{ alpha: 1, fillStyle: COVER, moves: 2, rule: 'evenodd' }])
    expect(canvas?.strokes).toEqual([])
  })

  it('cuts every area of the index unless told which', async () => {
    const source = createAreaMaskTileSource({ createCanvas, layer: { fillColor: COVER, index } })
    const canvas = await source.imageForTile(ON.x, ON.y, ON.z, 1)
    // The rectangle, OH and PA's part of the tile.
    expect(canvas?.fills[0]?.moves).toBe(3)
  })

  it('draws the edge of the cut-out over the mask, without the tile rectangle', async () => {
    const source = createAreaMaskTileSource({
      createCanvas,
      layer: {
        edge: { color: '#7f929d', opacity: 0.9, width: 1.2 },
        fillColor: COVER,
        ids: ['OH'],
        index,
      },
    })
    const canvas = await source.imageForTile(ON.x, ON.y, ON.z, 2)
    expect(canvas?.strokes).toEqual([
      { alpha: 0.9, lineWidth: 2.4, moves: 1, strokeStyle: '#7f929d' },
    ])
  })

  it('answers one shared flat image for tiles the cut-out does not reach', async () => {
    const source = createAreaMaskTileSource({
      createCanvas,
      layer: { fillColor: COVER, ids: ['OH'], index },
    })
    const first = await source.imageForTile(OFF.x, OFF.y, OFF.z, 1)
    const second = await source.imageForTile(OFF.x + 1, OFF.y, OFF.z, 1)
    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(first?.fills).toHaveLength(1)
    expect(first?.fills[0]?.moves).toBe(1)
    // Another device scale is another image.
    expect(await source.imageForTile(OFF.x, OFF.y, OFF.z, 2)).not.toBe(first)
  })

  it('also finds a shape one world over, for a map that repeats the world', async () => {
    // A square at the very east of the world, and the same tile asked for at x = -1.
    const east = createVectorTileAreaIndex([{ geometry: square(170, -10, 179, 10), id: 'E' }])
    const source = createAreaMaskTileSource({
      createCanvas,
      layer: { fillColor: COVER, index: east },
    })
    const wrapped = await source.imageForTile(15, 7, 4, 1)
    const unwrapped = await source.imageForTile(-1, 7, 4, 1)
    expect(wrapped?.fills[0]?.moves).toBe(2)
    expect(unwrapped?.fills[0]?.moves).toBe(2)
  })

  it('cuts every part of a multi-polygon', async () => {
    const islands = createVectorTileAreaIndex([
      {
        geometry: {
          coordinates: [square(-85, 38, -84, 39).coordinates, square(-81, 41, -80, 42).coordinates],
          type: 'MultiPolygon',
        },
        id: 'HI',
      },
    ])
    const source = createAreaMaskTileSource({
      createCanvas,
      layer: { fillColor: COVER, index: islands },
    })
    const canvas = await source.imageForTile(ON.x, ON.y, ON.z, 1)
    expect(canvas?.fills[0]?.moves).toBe(3)
  })

  it('answers null with no layer, and follows setLayer', async () => {
    const source = createAreaMaskTileSource({ createCanvas })
    expect(await source.imageForTile(ON.x, ON.y, ON.z, 1)).toBeNull()
    source.setLayer({ fillColor: COVER, index })
    expect(await source.imageForTile(ON.x, ON.y, ON.z, 1)).not.toBeNull()
    source.setLayer(null)
    expect(await source.imageForTile(ON.x, ON.y, ON.z, 1)).toBeNull()
  })
})
