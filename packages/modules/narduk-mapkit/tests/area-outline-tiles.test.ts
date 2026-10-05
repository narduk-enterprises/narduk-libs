import { describe, expect, it } from 'vitest'

import { createAreaOutlineTileSource, createVectorTileAreaIndex } from '../src/client/index.js'

import type { VectorTileCanvas, VectorTileCanvasContext } from '../src/client/index.js'

interface OutlineCanvas extends VectorTileCanvas {
  strokes: Array<{ lineWidth: number; strokeStyle: string; globalAlpha: number }>
  fills: number
}

function createCanvas(width: number, height: number): OutlineCanvas {
  const strokes: OutlineCanvas['strokes'] = []
  let fills = 0
  const context = {
    closePath: () => {},
    fill: () => {
      fills += 1
    },
    fillStyle: '',
    globalAlpha: 1,
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    beginPath: () => {},
    clearRect: () => {},
    lineTo: () => {},
    moveTo: () => {},
    stroke: () =>
      strokes.push({
        globalAlpha: context.globalAlpha,
        lineWidth: context.lineWidth,
        strokeStyle: String(context.strokeStyle),
      }),
  } as unknown as VectorTileCanvasContext
  return {
    get fills() {
      return fills
    },
    height,
    strokes,
    width,
    getContext: () => context,
  }
}

/** A box over Ohio-ish longitudes and latitudes. */
const BOX = {
  coordinates: [
    [
      [-85, 38],
      [-80, 38],
      [-80, 42],
      [-85, 42],
      [-85, 38],
    ],
  ],
  type: 'Polygon',
}

function layer() {
  return {
    index: createVectorTileAreaIndex([
      { data: { code: 'OH' }, geometry: BOX, id: 'OH' },
      { geometry: null, id: 'broken' },
    ]),
    style: () => ({ lineWidth: 0.8, strokeColor: '#7f929d' }),
  }
}

/** The z4 tile that holds -82.5, 40. */
const TILE = { x: 4, y: 6, z: 4 }

describe('createAreaOutlineTileSource', () => {
  it('paints an outline, and only an outline, into a tile the shape reaches', async () => {
    const source = createAreaOutlineTileSource({ createCanvas, layer: layer() })
    const canvas = await source.imageForTile(TILE.x, TILE.y, TILE.z, 2)
    expect(canvas).not.toBeNull()
    expect(canvas?.width).toBe(512)
    expect(canvas?.height).toBe(512)
    expect(canvas?.fills).toBe(0)
    // One device-scaled hairline in the layer's own colour, opaque: the layer's opacity quietens it.
    expect(canvas?.strokes).toEqual([{ globalAlpha: 1, lineWidth: 1.6, strokeStyle: '#7f929d' }])
  })

  it('answers null for a tile nothing reaches, and for no layer', async () => {
    const source = createAreaOutlineTileSource({ createCanvas, layer: layer() })
    expect(await source.imageForTile(0, 0, 4, 1)).toBeNull()
    const empty = createAreaOutlineTileSource({ createCanvas })
    expect(await empty.imageForTile(TILE.x, TILE.y, TILE.z, 1)).toBeNull()
  })

  it('draws another layer from the next tile after setLayer', async () => {
    const source = createAreaOutlineTileSource({ createCanvas })
    expect(source.layer).toBeNull()
    const next = layer()
    source.setLayer(next)
    expect(source.layer).toBe(next)
    expect(await source.imageForTile(TILE.x, TILE.y, TILE.z, 1)).not.toBeNull()
    source.setLayer(null)
    expect(await source.imageForTile(TILE.x, TILE.y, TILE.z, 1)).toBeNull()
  })

  it('shares its index with the pointer: the area under a point is the one drawn', () => {
    const { index } = layer()
    expect(index.hitTest({ latitude: 40, longitude: -82.5 })?.data).toEqual({ code: 'OH' })
    expect(index.hitTest({ latitude: 40, longitude: -70 })).toBeNull()
    expect(index.skipped).toEqual(['broken'])
  })
})
