import { buildDecodedVectorTile, paintVectorTile } from '../../src/client/index.js'

import type {
  DecodedVectorTile,
  VectorTileCanvas,
  VectorTileCanvasContext,
  VectorTileFeatureInput,
  VectorTileStyle,
} from '../../src/client/index.js'

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
        strokeStyle: String(context.strokeStyle),
      }),
  }
  return { calls, height, width, getContext: () => context }
}

function line(x0: number, y0: number, x1: number, y1: number) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ]
}

function feature(
  properties: VectorTileFeatureInput['properties'],
  y: number,
): VectorTileFeatureInput {
  return { lines: [line(0, y, 40, y)], properties }
}

function paint(
  tile: DecodedVectorTile,
  style: (properties: DecodedVectorTile['properties'][number]) => VectorTileStyle | null,
) {
  const canvas = createFakeCanvas(256, 256)
  paintVectorTile(canvas, tile, { pixelRatio: 1, style, tileSize: 256, zoom: 8 })
  return canvas
}

describe('batched ordered painter', () => {
  it('issues one stroke per colour-width batch, not one stroke per feature', () => {
    const tile = buildDecodedVectorTile(4096, [
      feature({ so: 1 }, 0),
      feature({ so: 2 }, 10),
      feature({ so: 3 }, 20),
      feature({ so: 4 }, 30),
    ])
    const canvas = paint(tile, (properties) =>
      Number(properties.so) <= 2 ? { color: '#2563eb', width: 1 } : { color: '#dc2626', width: 2 },
    )

    const strokes = canvas.calls.filter((call) => call.op === 'stroke')
    expect(strokes).toHaveLength(2)
    expect(strokes[0]).toMatchObject({ lineWidth: 1, strokeStyle: '#2563eb' })
    expect(strokes[1]).toMatchObject({ lineWidth: 2, strokeStyle: '#dc2626' })
    expect(canvas.calls.filter((call) => call.op === 'moveTo')).toHaveLength(4)
  })

  it('draws stream order ascending, then class severity ascending', () => {
    const tile = buildDecodedVectorTile(4096, [
      feature({ severity: 9, so: 5 }, 0),
      feature({ severity: 1, so: 1 }, 256),
      feature({ severity: 9, so: 1 }, 512),
      feature({ severity: 1, so: 5 }, 768),
    ])
    const canvas = paint(tile, (properties) => ({
      color: Number(properties.severity) === 9 ? '#dc2626' : '#2563eb',
      severity: Number(properties.severity),
      width: 1,
    }))

    expect(
      canvas.calls.filter((call) => call.op === 'stroke').map((call) => call.strokeStyle),
    ).toEqual(['#2563eb', '#dc2626', '#2563eb', '#dc2626'])
    // so=1 severity=1, so=1 severity=9, so=5 severity=1, so=5 severity=9
    // 256 tile-units is 16 CSS pixels at extent 4096 / tileSize 256.
    expect(canvas.calls.filter((call) => call.op === 'moveTo')).toEqual([
      { op: 'moveTo', args: [0, 16] },
      { op: 'moveTo', args: [0, 32] },
      { op: 'moveTo', args: [0, 48] },
      { op: 'moveTo', args: [0, 0] },
    ])
  })

  it('strokes the casing under the line, wider, before the colour stroke', () => {
    const tile = buildDecodedVectorTile(4096, [feature({ so: 2 }, 0), feature({ so: 3 }, 10)])
    const canvas = paint(tile, () => ({
      casing: { color: '#0f172a', extraWidth: 1.5 },
      color: '#38bdf8',
      width: 2,
    }))

    const strokes = canvas.calls.filter((call) => call.op === 'stroke')
    expect(strokes).toEqual([
      { op: 'stroke', globalAlpha: 1, lineWidth: 3.5, strokeStyle: '#0f172a' },
      { op: 'stroke', globalAlpha: 1, lineWidth: 2, strokeStyle: '#38bdf8' },
    ])
    const firstStrokeAt = canvas.calls.findIndex((call) => call.op === 'stroke')
    expect(canvas.calls[firstStrokeAt - 1]).toMatchObject({ op: 'lineTo' })
  })
})
