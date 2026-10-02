import {
  VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING,
  VECTOR_TILE_CLASS_NO_GAUGE,
  VECTOR_TILE_MISSING_ID,
  buildDecodedVectorTile,
  classTableMatchesNetwork,
  paintForVectorTileClass,
  paintVectorTile,
  vectorTileClassByte,
  vectorTileClassKeyAtZoom,
} from '../../src/client/index.js'
import { createMvtDecoder } from '../../src/vector-tiles/index.js'

import { encodeVectorTile } from './fixture.js'

import type {
  DecodedVectorTile,
  VectorTileCanvas,
  VectorTileCanvasContext,
  VectorTileClassStyle,
  VectorTileClassTable,
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

const unknown: VectorTileStyle = { color: '#6b7280', width: 1 }
const noGauge: VectorTileStyle = { color: '#93c5fd', width: 1 }
const notReporting: VectorTileStyle = { color: '#f59e0b', width: 1 }
const flooded: VectorTileStyle = { color: '#dc2626', width: 2 }
const normal: VectorTileStyle = { color: '#2563eb', width: 1 }

function tableFor(
  entries: Array<{ id: number; classByte: number }>,
  length = 8,
): VectorTileClassTable {
  const classes = new Uint8Array(length)
  for (const entry of entries) classes[entry.id] = entry.classByte
  return { classes, length, networkVersion: 2 }
}

function classStyle(
  classTable: VectorTileClassTable,
  overrides: Partial<VectorTileClassStyle> = {},
): VectorTileClassStyle {
  return {
    classTable,
    gaugeNotReporting: notReporting,
    noGauge,
    paintByClass: Object.assign(new Array<VectorTileStyle | undefined>(10), {
      1: normal,
      9: flooded,
    }),
    tileNetwork: { length: classTable.length, version: classTable.networkVersion },
    unknown,
    ...overrides,
  }
}

function line(x0: number, y0: number, x1: number, y1: number) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ]
}

describe('columnar so / si / ri', () => {
  it('packs so, si and ri as typed arrays and leaves other properties as objects', () => {
    const tile = buildDecodedVectorTile(4096, [
      {
        lines: [line(0, 0, 10, 10)],
        properties: { name: 'Brazos', ri: 4, si: 11, so: 6 },
      },
      {
        lines: [line(20, 20, 30, 30)],
        properties: { ri: 5, si: 12, so: 3 },
      },
    ])

    expect(tile.so).toEqual(new Uint8Array([6, 3]))
    expect(tile.si).toEqual(new Uint32Array([11, 12]))
    expect(tile.ri).toEqual(new Uint32Array([4, 5]))
    expect(tile.properties[0]).toEqual({ name: 'Brazos', ri: 4, si: 11, so: 6 })
  })

  it('records a missing id as the missing sentinel, not as 0', () => {
    const tile = buildDecodedVectorTile(4096, [
      { lines: [line(0, 0, 1, 1)], properties: { si: 0, so: 2 } },
      { lines: [line(2, 2, 3, 3)], properties: { so: 2 } },
    ])

    expect(tile.si?.[0]).toBe(0)
    expect(tile.si?.[1]).toBe(VECTOR_TILE_MISSING_ID)
    expect(tile.ri).toBeUndefined()
  })

  it('omits si on a v1 tile that never carried it', () => {
    const tile = buildDecodedVectorTile(4096, [
      { lines: [line(0, 0, 1, 1)], properties: { ri: 9, so: 4 } },
    ])

    expect(tile.si).toBeUndefined()
    expect(tile.ri).toEqual(new Uint32Array([9]))
    expect(tile.so).toEqual(new Uint8Array([4]))
  })
})

describe('class-table lookup', () => {
  const classes = tableFor(
    [
      { id: 1, classByte: 1 },
      { id: 2, classByte: VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING },
      { id: 3, classByte: VECTOR_TILE_CLASS_NO_GAUGE },
      { id: 4, classByte: 9 },
    ],
    6,
  )

  it('reads si below the zoom threshold and ri from it', () => {
    const style = classStyle(classes, { zoomThreshold: 8 })

    expect(vectorTileClassKeyAtZoom(style, 7)).toBe('si')
    expect(vectorTileClassKeyAtZoom(style, 8)).toBe('ri')
  })

  it('keeps reserved 254, reserved 255 and unknown distinct from each other and from paintByClass', () => {
    const style = classStyle(classes)
    // A caller that stuffed reserved indexes into paintByClass must not win.
    style.paintByClass = Object.assign([], style.paintByClass, {
      254: { color: '#111111', width: 9 },
      255: { color: '#222222', width: 9 },
    })

    expect(paintForVectorTileClass(style, 1, true).color).toBe(normal.color)
    expect(paintForVectorTileClass(style, VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING, true).color).toBe(
      notReporting.color,
    )
    expect(paintForVectorTileClass(style, VECTOR_TILE_CLASS_NO_GAUGE, true).color).toBe(
      noGauge.color,
    )
    expect(paintForVectorTileClass(style, null, true).color).toBe(unknown.color)
    expect(paintForVectorTileClass(style, 1, false).color).toBe(unknown.color)
  })

  it('returns no data, not class 0, when the chosen column is absent or the id is missing', () => {
    const v1 = buildDecodedVectorTile(4096, [
      { lines: [line(0, 0, 1, 1)], properties: { ri: 1, so: 2 } },
    ])
    const missingSi = buildDecodedVectorTile(4096, [
      { lines: [line(0, 0, 1, 1)], properties: { si: 1, so: 2 } },
      { lines: [line(2, 2, 3, 3)], properties: { so: 2 } },
    ])

    expect(vectorTileClassByte(v1, 0, 'si', classes)).toBeNull()
    expect(vectorTileClassByte(missingSi, 1, 'si', classes)).toBeNull()
    expect(vectorTileClassByte(v1, 0, 'ri', classes)).toBe(1)
  })

  it('treats a version or length mismatch as unknown, never a wrong colour', () => {
    expect(classTableMatchesNetwork(classes, { length: 6, version: 2 })).toBe(true)
    expect(classTableMatchesNetwork(classes, { length: 6, version: 3 })).toBe(false)
    expect(classTableMatchesNetwork(classes, { length: 7, version: 2 })).toBe(false)
    expect(classTableMatchesNetwork({ ...classes, length: 5 }, { length: 5, version: 2 })).toBe(
      false,
    )
  })
})

describe('class-table painter', () => {
  function strokes(tile: DecodedVectorTile, style: VectorTileClassStyle, zoom: number) {
    const canvas = createFakeCanvas(256, 256)
    paintVectorTile(canvas, tile, {
      pixelRatio: 1,
      style,
      tileSize: 256,
      zoom,
      ...(style.tileNetwork ? { tileNetwork: style.tileNetwork } : {}),
    })
    return canvas.calls.filter((call) => call.op === 'stroke')
  }

  it('switches the lookup key at the zoom threshold', () => {
    const tile = buildDecodedVectorTile(4096, [
      {
        lines: [line(0, 0, 40, 40)],
        properties: { ri: 4, si: 1, so: 5 },
      },
    ])
    const style = classStyle(
      tableFor(
        [
          { id: 1, classByte: 1 },
          { id: 4, classByte: 9 },
        ],
        6,
      ),
    )

    expect(strokes(tile, style, 7)[0]).toMatchObject({ strokeStyle: normal.color })
    expect(strokes(tile, style, 8)[0]).toMatchObject({ strokeStyle: flooded.color })
  })

  it('paints 254, 255 and unknown as the colours the style supplied, not each other', () => {
    const tile = buildDecodedVectorTile(4096, [
      { lines: [line(0, 0, 10, 0)], properties: { si: 2, so: 1 } },
      { lines: [line(0, 10, 10, 10)], properties: { si: 3, so: 2 } },
      { lines: [line(0, 20, 10, 20)], properties: { si: 1, so: 3 } },
      { lines: [line(0, 30, 10, 30)], properties: { so: 4 } },
    ])
    const style = classStyle(
      tableFor(
        [
          { id: 1, classByte: 1 },
          { id: 2, classByte: VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING },
          { id: 3, classByte: VECTOR_TILE_CLASS_NO_GAUGE },
        ],
        6,
      ),
    )

    expect(strokes(tile, style, 4).map((call) => call.strokeStyle)).toEqual([
      notReporting.color,
      noGauge.color,
      normal.color,
      unknown.color,
    ])
  })

  it('draws every feature as unknown when the table does not match the tiles', () => {
    const tile = buildDecodedVectorTile(4096, [
      { lines: [line(0, 0, 10, 0)], properties: { si: 1, so: 4 } },
      { lines: [line(0, 10, 10, 10)], properties: { si: 4, so: 4 } },
    ])
    const style = classStyle(
      tableFor(
        [
          { id: 1, classByte: 1 },
          { id: 4, classByte: 9 },
        ],
        6,
      ),
      {
        tileNetwork: { length: 6, version: 99 },
      },
    )

    expect(strokes(tile, style, 4).map((call) => call.strokeStyle)).toEqual([unknown.color])
  })

  it('still paints a v1 tile that has no si, as unknown below the threshold and by ri from it', () => {
    const tile = buildDecodedVectorTile(4096, [
      { lines: [line(0, 0, 10, 10)], properties: { ri: 4, so: 5 } },
    ])
    const style = classStyle(tableFor([{ id: 4, classByte: 9 }], 6))

    expect(tile.si).toBeUndefined()
    expect(strokes(tile, style, 7)[0]).toMatchObject({ strokeStyle: unknown.color })
    expect(strokes(tile, style, 8)[0]).toMatchObject({ strokeStyle: flooded.color })
  })
})

describe('createMvtDecoder columns', () => {
  const address = { x: 31, y: 48, z: 7 }

  it('decodes so, si and ri into columns from a v2 tile', async () => {
    const bytes = encodeVectorTile([
      {
        features: [
          {
            lines: [line(0, 0, 8, 8)],
            properties: { ri: 3, si: 21, so: 7 },
            type: 2,
          },
        ],
        name: 'reaches',
      },
    ])

    const tile = await createMvtDecoder()(bytes, address)

    expect(tile?.so).toEqual(new Uint8Array([7]))
    expect(tile?.si).toEqual(new Uint32Array([21]))
    expect(tile?.ri).toEqual(new Uint32Array([3]))
  })

  it('decodes a v1 tile without si and still returns geometry', async () => {
    const bytes = encodeVectorTile([
      {
        features: [
          {
            lines: [line(1, 1, 2, 2)],
            properties: { ri: 8, so: 4 },
            type: 2,
          },
        ],
        name: 'reaches',
      },
    ])

    const tile = await createMvtDecoder()(bytes, address)

    expect(tile?.si).toBeUndefined()
    expect(tile?.ri).toEqual(new Uint32Array([8]))
    expect(tile?.coordinates.length).toBe(4)
  })
})
