import { buildDecodedVectorTile, createVectorTileOverlaySource } from '../../src/client/index.js'

import type {
  DecodedVectorTile,
  VectorTileCanvas,
  VectorTileCanvasContext,
  VectorTileOverlayStyle,
  VectorTileRestyleHost,
  VectorTileStyleFunction,
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

const reach: DecodedVectorTile = buildDecodedVectorTile(4096, [
  {
    lines: [
      [
        { x: 0, y: 0 },
        { x: 40, y: 40 },
      ],
    ],
    properties: { ri: 1, si: 1, so: 5 },
  },
])

function styleOf(color: string): VectorTileStyleFunction {
  return () => ({ color, width: 1 })
}

describe('restyle without a blank frame', () => {
  it('keeps the old overlay until the new one has drawn, without refetching or re-decoding', async () => {
    const fetched: string[] = []
    const decoded: string[] = []
    let releaseDraw: (() => void) | undefined
    const drawGate = new Promise<void>((resolve) => {
      releaseDraw = resolve
    })
    let drawCount = 0

    const overlays: Array<{ id: number; drawn: boolean }> = []
    let nextId = 0
    let markReplaceStarted: (() => void) | undefined
    const replaceStarted = new Promise<void>((resolve) => {
      markReplaceStarted = resolve
    })
    const replaceCalls: Array<{
      activateWhen: string | undefined
      overlayCountBeforeDraw: number
    }> = []

    const source = createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: (_bytes, { x, y, z }) => {
        decoded.push(`${z}/${x}/${y}`)
        return Promise.resolve(reach)
      },
      style: styleOf('#2563eb'),
      tileBytes: (z, x, y) => {
        fetched.push(`${z}/${x}/${y}`)
        return Promise.resolve(new Uint8Array([1]))
      },
    })

    const initial = { id: nextId++, drawn: true }
    overlays.push(initial)
    await source.imageForTile(0, 0, 7, 1)

    const host: VectorTileRestyleHost<FakeCanvas> = {
      layerId: 'network',
      async replace(_id, descriptor, options) {
        const incoming = { id: nextId++, drawn: false }
        overlays.push(incoming)
        markReplaceStarted?.()
        replaceCalls.push({
          activateWhen: options?.activateWhen,
          overlayCountBeforeDraw: overlays.length,
        })
        if (options?.activateWhen === 'first-image') {
          drawCount += 1
          if (drawCount === 1) await drawGate
        }
        const image = await descriptor.imageForTile(0, 0, 7, 1)
        incoming.drawn = image !== null
        expect(overlays.map((overlay) => overlay.id)).toContain(initial.id)
        overlays.splice(0, overlays.length, incoming)
      },
    }
    source.setRestyleHost(host)

    const restyle = source.restyle(styleOf('#dc2626'))
    await replaceStarted
    expect(overlays.map((overlay) => overlay.id)).toEqual([initial.id, 1])
    expect(overlays[0]?.drawn).toBe(true)
    expect(overlays[1]?.drawn).toBe(false)

    releaseDraw?.()
    await restyle

    expect(replaceCalls).toEqual([{ activateWhen: 'first-image', overlayCountBeforeDraw: 2 }])
    expect(overlays).toEqual([{ id: 1, drawn: true }])
    expect(fetched).toEqual(['7/0/0'])
    expect(decoded).toEqual(['7/0/0'])
    expect(source.size).toBe(1)
  })

  it('coalesces rapid restyles to the latest style and one swap', async () => {
    const fetched: string[] = []
    const decoded: string[] = []
    let replaceCount = 0
    let lastColor = ''

    const source = createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: (_bytes, { x, y, z }) => {
        decoded.push(`${z}/${x}/${y}`)
        return Promise.resolve(reach)
      },
      style: styleOf('#111111'),
      tileBytes: (z, x, y) => {
        fetched.push(`${z}/${x}/${y}`)
        return Promise.resolve(new Uint8Array([1]))
      },
    })
    await source.imageForTile(0, 0, 7, 1)

    source.setRestyleHost({
      layerId: 'network',
      async replace(_id, descriptor) {
        replaceCount += 1
        const image = await descriptor.imageForTile(0, 0, 7, 1)
        const stroke = image?.calls.find((call) => call.op === 'stroke')
        lastColor = stroke && stroke.op === 'stroke' ? stroke.strokeStyle : ''
      },
    })

    const first: VectorTileOverlayStyle = styleOf('#aaaaaa')
    const second: VectorTileOverlayStyle = styleOf('#bbbbbb')
    const third: VectorTileOverlayStyle = styleOf('#cccccc')
    await Promise.all([source.restyle(first), source.restyle(second), source.restyle(third)])

    expect(replaceCount).toBe(1)
    expect(lastColor).toBe('#cccccc')
    expect(fetched).toEqual(['7/0/0'])
    expect(decoded).toEqual(['7/0/0'])
  })

  it('setClassTable restyles from the cache through the same swap path', async () => {
    const fetched: string[] = []
    const decoded: string[] = []
    const classes = new Uint8Array(4)
    classes[1] = 1
    const next = new Uint8Array(4)
    next[1] = 9
    let painted = ''

    const source = createVectorTileOverlaySource<FakeCanvas>({
      createCanvas: createFakeCanvas,
      decode: (_bytes, { x, y, z }) => {
        decoded.push(`${z}/${x}/${y}`)
        return Promise.resolve(reach)
      },
      style: {
        classTable: { classes, length: 4, networkVersion: 2 },
        gaugeNotReporting: { color: '#f59e0b', width: 1 },
        noGauge: { color: '#93c5fd', width: 1 },
        paintByClass: Object.assign(new Array<{ color: string; width: number } | undefined>(10), {
          1: { color: '#2563eb', width: 1 },
          9: { color: '#dc2626', width: 2 },
        }),
        tileNetwork: { length: 4, version: 2 },
        unknown: { color: '#6b7280', width: 1 },
      },
      tileBytes: (z, x, y) => {
        fetched.push(`${z}/${x}/${y}`)
        return Promise.resolve(new Uint8Array([1]))
      },
      tileNetwork: { length: 4, version: 2 },
    })
    await source.imageForTile(0, 0, 8, 1)

    source.setRestyleHost({
      layerId: 'network',
      async replace(_id, descriptor) {
        const image = await descriptor.imageForTile(0, 0, 8, 1)
        const stroke = image?.calls.find((call) => call.op === 'stroke')
        painted = stroke && stroke.op === 'stroke' ? stroke.strokeStyle : ''
      },
    })

    await source.setClassTable({ classes: next, length: 4, networkVersion: 2 })

    expect(painted).toBe('#dc2626')
    expect(fetched).toEqual(['8/0/0'])
    expect(decoded).toEqual(['8/0/0'])
  })
})
