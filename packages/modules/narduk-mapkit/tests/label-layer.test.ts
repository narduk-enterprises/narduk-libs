import { describe, expect, it, vi } from 'vitest'

import {
  LABEL_LAYER_DEFAULT_MARGIN_PX,
  LABEL_LAYER_DEFAULT_MAX_LABELS,
  LABEL_LAYER_NATIONAL_FRAME_BUDGET,
  MAP_WORLD_TILE_PX,
  POINT_CLASS_NO_DATA,
  POINT_CLASS_NOT_REPORTING,
  createLabelLayer,
  createPointLayer,
  resolveHit,
} from '../src/client/index.js'

import type {
  LabelAnchor,
  LabelCanvas,
  LabelCanvasContext,
  LabelObstacle,
  LabelStyle,
  LabelView,
  PointClassTable,
} from '../src/client/index.js'

const STYLE: LabelStyle = {
  fill: '#102030',
  fontFamily: 'Test Sans',
  fontSize: 10,
  halo: '#f0f0f0',
  haloWidth: 3,
}

const VIEW: LabelView = { height: 800, latitude: 40, longitude: -90, width: 1000, zoom: 6 }

/** 6 px per character at a 10 px font: a 10-character name is a 60 px box. */
const measureText = (text: string, font: string): number => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)
  return text.length * size * 0.6
}

/** The coordinate `dx`, `dy` CSS pixels from the view's centre. */
function atPixel(view: LabelView, dx: number, dy: number) {
  const world = MAP_WORLD_TILE_PX * 2 ** view.zoom
  const centerX = (view.longitude + 180) / 360
  const radians = (view.latitude * Math.PI) / 180
  const centerY = (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2
  const y = centerY + dy / world
  return {
    latitude: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
    longitude: (centerX + dx / world) * 360 - 180,
  }
}

function anchorAt(
  view: LabelView,
  dx: number,
  dy: number,
  text: string,
  extra: Partial<LabelAnchor> = {},
): LabelAnchor {
  return { ...atPixel(view, dx, dy), minZoom: 0, priority: 1, text, ...extra }
}

function layerFor(anchors: LabelAnchor[], extra: Record<string, unknown> = {}) {
  return createLabelLayer({ anchors, measureText, style: STYLE, ...extra })
}

type Call =
  | { op: 'clearRect' | 'setTransform'; args: number[] }
  | {
      op: 'strokeText' | 'fillText'
      text: string
      x: number
      y: number
      font: string
      color: string
      lineWidth: number
    }

interface FakeLabelCanvas extends LabelCanvas {
  calls: Call[]
  sizeWrites: number
}

function fakeCanvas(): FakeLabelCanvas {
  const calls: Call[] = []
  const context: LabelCanvasContext = {
    fillStyle: '',
    font: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    textAlign: '',
    textBaseline: '',
    clearRect: (...args) => calls.push({ op: 'clearRect', args }),
    fillText: (text, x, y) =>
      calls.push({
        op: 'fillText',
        color: String(context.fillStyle),
        font: context.font,
        lineWidth: context.lineWidth,
        text,
        x,
        y,
      }),
    measureText: (text) => ({ width: measureText(text, context.font) }),
    setTransform: (...args) => calls.push({ op: 'setTransform', args }),
    strokeText: (text, x, y) =>
      calls.push({
        op: 'strokeText',
        color: String(context.strokeStyle),
        font: context.font,
        lineWidth: context.lineWidth,
        text,
        x,
        y,
      }),
  }
  const canvas = {
    calls,
    sizeWrites: 0,
    getContext: () => context,
    _height: 0,
    _width: 0,
    get height() {
      return this._height
    },
    set height(value: number) {
      this._height = value
      this.sizeWrites += 1
    },
    get width() {
      return this._width
    },
    set width(value: number) {
      this._width = value
      this.sizeWrites += 1
    },
  }
  return canvas
}

const texts = (layer: ReturnType<typeof layerFor>, view = VIEW) =>
  layer.place(view).labels.map((label) => label.text)

describe('label layer: priority and the stable tie-break', () => {
  it('places the higher priority first, whatever the input order', () => {
    const low = anchorAt(VIEW, 0, 0, 'Low River', { priority: 4 })
    const high = anchorAt(VIEW, 10, 0, 'High River', { priority: 9 })
    expect(texts(layerFor([low, high]))).toEqual(['High River'])
    expect(texts(layerFor([high, low]))).toEqual(['High River'])
  })

  it('breaks a tie on the stable key, not on input order', () => {
    const a = anchorAt(VIEW, 0, 0, 'Same Rank', { id: 'a-1' })
    const b = anchorAt(VIEW, 5, 0, 'Same Rank', { id: 'b-1' })
    const forward = layerFor([a, b])
      .place(VIEW)
      .labels.map((label) => label.id)
    const reverse = layerFor([b, a])
      .place(VIEW)
      .labels.map((label) => label.id)
    expect(forward).toEqual(['a-1'])
    expect(reverse).toEqual(['a-1'])
  })

  it('breaks a tie between id-less anchors on text and position', () => {
    const north = anchorAt(VIEW, 0, 0, 'Alpha')
    const south = anchorAt(VIEW, 5, 0, 'Beta')
    expect(texts(layerFor([south, north]))).toEqual(['Alpha'])
    expect(texts(layerFor([north, south]))).toEqual(['Alpha'])
  })

  it('gives the same labels for the same anchors, view and size every time', () => {
    const anchors = scatter(400)
    const first = layerFor(anchors).place(VIEW)
    const second = layerFor([...anchors].reverse()).place(VIEW)
    expect(second.labels.map((label) => label.text)).toEqual(
      first.labels.map((label) => label.text),
    )
    expect(second.labels.map((label) => [label.x, label.y])).toEqual(
      first.labels.map((label) => [label.x, label.y]),
    )
  })
})

describe('label layer: collisions', () => {
  it('drops a label that overlaps a placed one, and keeps the winner where it was', () => {
    const winner = anchorAt(VIEW, 0, 0, 'Mississippi', { priority: 10 })
    const loser = anchorAt(VIEW, 20, 4, 'Ohio', { priority: 5 })
    const clear = anchorAt(VIEW, 0, 100, 'Tennessee', { priority: 1 })
    const placement = layerFor([loser, clear, winner]).place(VIEW)

    expect(placement.labels.map((label) => label.text)).toEqual(['Mississippi', 'Tennessee'])
    expect(placement.stats.droppedByLabel).toBe(1)
    const kept = placement.labels[0]
    expect(kept?.x).toBeCloseTo(500, 6)
    expect(kept?.y).toBeCloseTo(400, 6)
  })

  it('drops a label that overlaps a circular obstacle and one that overlaps a rectangle', () => {
    const anchors = [
      anchorAt(VIEW, 0, 0, 'Under Dot'),
      anchorAt(VIEW, 0, 100, 'Under Box'),
      anchorAt(VIEW, 0, 200, 'Clear'),
    ]
    const obstacles = (): LabelObstacle[] => [
      { radius: 4, x: 500 + 10, y: 400 },
      { height: 30, width: 30, x: 500 - 15, y: 500 - 15 },
    ]
    const placement = layerFor(anchors, { obstacles }).place(VIEW)
    expect(placement.labels.map((label) => label.text)).toEqual(['Clear'])
    expect(placement.stats.droppedByObstacle).toBe(2)
    expect(placement.stats.obstacles).toBe(2)
  })

  it('keeps a label whose box just clears an obstacle', () => {
    // "Name" is 24 px wide, 12 px tall; grown by 2 padding + 1.5 halo each side.
    const half = 12 + 2 + 1.5
    const obstacles = (): LabelObstacle[] => [{ radius: 3, x: 500 + half + 3.01, y: 400 }]
    expect(texts(layerFor([anchorAt(VIEW, 0, 0, 'Name')], { obstacles }))).toEqual(['Name'])
    const touching = (): LabelObstacle[] => [{ radius: 3, x: 500 + half + 2.9, y: 400 }]
    expect(texts(layerFor([anchorAt(VIEW, 0, 0, 'Name')], { obstacles: touching }))).toEqual([])
  })

  it('ignores an obstacle that is not a finite shape', () => {
    const obstacles = (): LabelObstacle[] => [
      { radius: Number.NaN, x: 500, y: 400 },
      { height: 0, width: 10, x: 500, y: 400 },
    ]
    const placement = layerFor([anchorAt(VIEW, 0, 0, 'Name')], { obstacles }).place(VIEW)
    expect(placement.labels).toHaveLength(1)
    expect(placement.stats.obstacles).toBe(0)
  })
})

describe('label layer: first zoom, visible region and cap', () => {
  it('skips an anchor below its first zoom and shows it at that zoom', () => {
    const anchors = [anchorAt(VIEW, 0, 0, 'Late', { minZoom: 6.5 })]
    const layer = layerFor(anchors)
    const below = layer.place({ ...VIEW, zoom: 6.4 })
    expect(below.labels).toEqual([])
    expect(below.stats.belowMinZoom).toBe(1)
    const at = { ...VIEW, zoom: 6.5 }
    expect(layer.place(at).labels).toHaveLength(1)
  })

  it('considers only anchors inside the region plus the margin', () => {
    const edge = VIEW.width / 2
    const anchors = [
      anchorAt(VIEW, 0, 0, 'Inside'),
      anchorAt(VIEW, edge + LABEL_LAYER_DEFAULT_MARGIN_PX - 5, 0, 'InMargin'),
      anchorAt(VIEW, edge + LABEL_LAYER_DEFAULT_MARGIN_PX + 5, 0, 'TooFar'),
      anchorAt(VIEW, 0, -VIEW.height / 2 - LABEL_LAYER_DEFAULT_MARGIN_PX - 5, 'Above'),
    ]
    const placement = layerFor(anchors).place(VIEW)
    expect(placement.labels.map((label) => label.text).sort()).toEqual(['InMargin', 'Inside'])
    expect(placement.stats.outsideRegion).toBe(2)
    expect(
      layerFor(anchors, { marginPx: 0 })
        .place(VIEW)
        .labels.map((l) => l.text),
    ).toEqual(['Inside'])
  })

  it('sees an anchor across the antimeridian as near', () => {
    const view: LabelView = { ...VIEW, longitude: 179.9, zoom: 8 }
    const across = anchorAt(view, 100, 0, 'Across')
    expect(across.longitude).toBeGreaterThan(180)
    const wrapped = { ...across, longitude: across.longitude - 360 }
    expect(texts(layerFor([wrapped]), view)).toEqual(['Across'])
  })

  it('caps labels per frame at the stated default, highest priority kept', () => {
    expect(LABEL_LAYER_DEFAULT_MAX_LABELS).toBe(200)
    const anchors: LabelAnchor[] = []
    for (let index = 0; index < 300; index += 1) {
      const column = index % 20
      const row = Math.floor(index / 20)
      anchors.push(
        anchorAt(VIEW, -480 + column * 50, -380 + row * 25, `L${index}`, { priority: index }),
      )
    }
    const placement = layerFor(anchors).place(VIEW)
    expect(placement.labels).toHaveLength(LABEL_LAYER_DEFAULT_MAX_LABELS)
    expect(placement.stats.capped).toBe(true)
    expect(placement.labels[0]?.text).toBe('L299')
    expect(placement.labels.some((label) => label.text === 'L0')).toBe(false)

    const few = layerFor(anchors, { maxLabels: 7 }).place(VIEW)
    expect(few.labels).toHaveLength(7)
    expect(layerFor(anchors, { maxLabels: 0 }).place(VIEW).labels).toEqual([])
    expect(layerFor(anchors.slice(0, 5)).place(VIEW).stats.capped).toBe(false)
  })
})

describe('label layer: measure cache', () => {
  it('measures a distinct string and style once, across frames', () => {
    const measure = vi.fn(measureText)
    const anchors = [
      anchorAt(VIEW, -300, 0, 'Same'),
      anchorAt(VIEW, 0, 0, 'Same'),
      anchorAt(VIEW, 300, 0, 'Other'),
    ]
    const layer = layerFor(anchors, { measureText: measure })
    const first = layer.place(VIEW)
    expect(first.labels).toHaveLength(3)
    expect(measure).toHaveBeenCalledTimes(2)
    expect(first.stats.measured).toBe(2)

    const second = layer.place({ ...VIEW, longitude: VIEW.longitude + 0.01 })
    expect(measure).toHaveBeenCalledTimes(2)
    expect(second.stats.measured).toBe(0)
    expect(layer.cacheStats).toMatchObject({ hits: 4, misses: 2, size: 2 })
  })

  it('keys on the style as well as the text', () => {
    const measure = vi.fn(measureText)
    const style = (anchor: LabelAnchor): LabelStyle => ({
      ...STYLE,
      fontSize: anchor.priority > 5 ? 14 : 10,
    })
    const anchors = [
      anchorAt(VIEW, -300, 0, 'Same', { priority: 9 }),
      anchorAt(VIEW, 0, 0, 'Same', { priority: 1 }),
    ]
    layerFor(anchors, { measureText: measure, style }).place(VIEW)
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('stays inside its bound and drops the least recently used width first', () => {
    const measure = vi.fn(measureText)
    const names = Array.from({ length: 12 }, (_, index) => `River ${index}`)
    const anchors = names.map((name, index) => anchorAt(VIEW, -440 + index * 80, 0, name))
    const wide = layerFor(anchors, { measureCacheLimit: 4, measureText: measure })
    wide.place(VIEW)
    expect(wide.cacheStats.size).toBe(4)
    expect(wide.cacheStats.limit).toBe(4)
    expect(measure).toHaveBeenCalledTimes(12)

    const lru = vi.fn(measureText)
    const layer = layerFor([anchorAt(VIEW, 0, 0, 'AA'), anchorAt(VIEW, 100, 0, 'BB')], {
      measureCacheLimit: 2,
      measureText: lru,
    })
    layer.place(VIEW)
    expect(lru).toHaveBeenCalledTimes(2)
    layer.setAnchors([anchorAt(VIEW, 0, 0, 'AA')])
    layer.place(VIEW) // AA is a hit and is now the most recently used
    layer.setAnchors([anchorAt(VIEW, 0, 0, 'CC')])
    layer.place(VIEW) // CC is new: BB, the least recently used, leaves
    expect(lru).toHaveBeenCalledTimes(3)
    layer.setAnchors([anchorAt(VIEW, 0, 0, 'AA')])
    layer.place(VIEW)
    expect(lru).toHaveBeenCalledTimes(3)
    layer.setAnchors([anchorAt(VIEW, 0, 0, 'BB')])
    layer.place(VIEW)
    expect(lru).toHaveBeenCalledTimes(4)
    expect(layer.cacheStats.size).toBe(2)
  })

  it('measures on a canvas when no measure function is given', () => {
    const context = fakeCanvas().getContext('2d')
    const createCanvas = vi.fn(() => ({ getContext: () => context, height: 1, width: 1 }))
    const layer = createLabelLayer({
      anchors: [anchorAt(VIEW, 0, 0, 'Canvas')],
      createCanvas,
      style: STYLE,
    })
    expect(layer.place(VIEW).labels[0]?.width).toBe(36)
    layer.place(VIEW)
    expect(createCanvas).toHaveBeenCalledTimes(1)
  })

  it('skips a string that cannot be measured instead of guessing a width', () => {
    const layer = layerFor([anchorAt(VIEW, 0, 0, 'Odd')], { measureText: () => Number.NaN })
    const placement = layer.place(VIEW)
    expect(placement.labels).toEqual([])
    expect(placement.stats.unmeasurable).toBe(1)
  })
})

describe('label layer: painting', () => {
  it('paints the halo under the fill in the caller colours and font', () => {
    const canvas = fakeCanvas()
    layerFor([anchorAt(VIEW, 0, 0, 'Halo')]).paint(VIEW, canvas)
    const ops = canvas.calls.filter((call) => call.op === 'strokeText' || call.op === 'fillText')
    expect(ops.map((call) => call.op)).toEqual(['strokeText', 'fillText'])
    expect(ops[0]).toMatchObject({ color: '#f0f0f0', font: 'normal 10px Test Sans', lineWidth: 3 })
    expect(ops[1]).toMatchObject({ color: '#102030', font: 'normal 10px Test Sans' })
  })

  it('paints no halo stroke when the halo is zero wide', () => {
    const canvas = fakeCanvas()
    createLabelLayer({
      anchors: [anchorAt(VIEW, 0, 0, 'Plain')],
      measureText,
      style: { ...STYLE, haloWidth: 0 },
    }).paint(VIEW, canvas)
    expect(canvas.calls.map((call) => call.op)).not.toContain('strokeText')
  })

  it('refuses a style with no colours rather than inventing a brand colour', () => {
    expect(() => layerFor([], { style: { fontFamily: 'x', fontSize: 10, haloWidth: 1 } })).toThrow(
      /colours from the caller/,
    )
  })

  it.each([1, 2, 3])('is crisp and the same set of labels at %ix', (ratio) => {
    const anchors = [anchorAt(VIEW, 0.3, 0.3, 'Crisp'), anchorAt(VIEW, 100.37, 50.61, 'Sharp')]
    const layer = layerFor(anchors)
    const canvas = fakeCanvas()
    const placement = layer.paint({ ...VIEW, pixelRatio: ratio }, canvas)

    expect(placement.labels.map((label) => label.text)).toEqual(['Crisp', 'Sharp'])
    expect(canvas.width).toBe(VIEW.width * ratio)
    expect(canvas.height).toBe(VIEW.height * ratio)
    expect(canvas.calls.find((call) => call.op === 'setTransform')).toMatchObject({
      args: [ratio, 0, 0, ratio, 0, 0],
    })
    const fills = canvas.calls.filter((call) => call.op === 'fillText')
    expect(fills).toHaveLength(2)
    for (const call of fills) {
      if (call.op !== 'fillText') continue
      // A CSS-pixel position that lands on a whole device pixel.
      expect(Number.isInteger(Math.round(call.x * ratio * 1e6) / 1e6)).toBe(true)
      expect(Number.isInteger(Math.round(call.y * ratio * 1e6) / 1e6)).toBe(true)
      // The font stays in CSS pixels; the transform does the scaling.
      expect(call.font).toBe('normal 10px Test Sans')
    }
    // Same CSS-pixel placement at every ratio.
    expect(placement.labels.map((label) => label.x)).toEqual(
      layerFor(anchors)
        .place({ ...VIEW, pixelRatio: 1 })
        .labels.map((label) => label.x),
    )
  })

  it('resizes the backing store only when it changed', () => {
    const canvas = fakeCanvas()
    const layer = layerFor([anchorAt(VIEW, 0, 0, 'Resize')])
    layer.paint({ ...VIEW, pixelRatio: 2 }, canvas)
    const writes = canvas.sizeWrites
    layer.paint({ ...VIEW, pixelRatio: 2 }, canvas)
    expect(canvas.sizeWrites).toBe(writes)
    layer.paint({ ...VIEW, pixelRatio: 3 }, canvas)
    expect(canvas.sizeWrites).toBe(writes + 2)
  })

  it('rejects a pixel ratio that is not a positive number', () => {
    expect(() => layerFor([]).paint({ ...VIEW, pixelRatio: 0 }, fakeCanvas())).toThrow(RangeError)
  })

  it('coalesces region changes into one paint of the latest view', () => {
    const frames: Array<() => void> = []
    const canvas = fakeCanvas()
    const onPainted = vi.fn()
    const layer = layerFor([anchorAt(VIEW, 0, 0, 'Frame')], {
      cancelAnimationFrame: () => {},
      canvas,
      onPainted,
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
    })
    layer.requestPaint({ ...VIEW, longitude: -91 })
    layer.requestPaint({ ...VIEW, longitude: -90.5 })
    layer.requestPaint(VIEW)
    expect(frames).toHaveLength(1)
    expect(onPainted).not.toHaveBeenCalled()
    frames[0]?.()
    expect(onPainted).toHaveBeenCalledTimes(1)
    const painted = onPainted.mock.calls[0]?.[0].labels[0]
    expect(painted?.text).toBe('Frame')
    // Centred: the latest view was painted, not the first request.
    expect(painted?.x).toBeCloseTo(500, 6)

    layer.requestPaint(VIEW)
    layer.destroy()
    frames[1]?.()
    expect(onPainted).toHaveBeenCalledTimes(1)
  })
})

describe('label layer: hit test', () => {
  const anchors = [
    anchorAt(VIEW, 0, 0, 'Mississippi River', { id: 28_641, priority: 10 }),
    anchorAt(VIEW, 0, 100, 'No Id River'),
  ]

  it('answers the label under a point with its anchor id', () => {
    const layer = layerFor(anchors)
    layer.place(VIEW)
    const hit = layer.labelAt(atPixel(VIEW, 20, 3), 0, VIEW.zoom)
    expect(hit).toEqual({ id: 28_641, index: 0, text: 'Mississippi River' })
  })

  it('misses beyond the box, honours tolerance, and says no id rather than 0', () => {
    const layer = layerFor(anchors)
    layer.place(VIEW)
    // "Mississippi River" is 17 chars * 6 = 102 px wide, 12 px tall.
    expect(layer.labelAt(atPixel(VIEW, 60, 0), 0, VIEW.zoom)).toBeNull()
    expect(layer.labelAt(atPixel(VIEW, 60, 0), 12, VIEW.zoom)?.index).toBe(0)
    const noId = layer.labelAt(atPixel(VIEW, 0, 100), 0, VIEW.zoom)
    expect(noId?.index).toBe(1)
    expect(noId?.id).toBeUndefined()
  })

  it('has no answer before a frame, after the anchors change, or at another zoom', () => {
    const layer = layerFor(anchors)
    expect(layer.labelAt(atPixel(VIEW, 0, 0), 8, VIEW.zoom)).toBeNull()
    layer.place(VIEW)
    expect(layer.labelAt(atPixel(VIEW, 0, 0), 8, VIEW.zoom + 1)).toBeNull()
    layer.setAnchors([])
    expect(layer.labelAt(atPixel(VIEW, 0, 0), 8, VIEW.zoom)).toBeNull()
  })

  it('does not hit a label that was dropped', () => {
    const layer = layerFor(
      [
        anchorAt(VIEW, 0, 0, 'Winner', { id: 1, priority: 9 }),
        anchorAt(VIEW, 0, 100, 'Dropped', { id: 2 }),
      ],
      { obstacles: () => [{ radius: 20, x: 500, y: 500 }] },
    )
    layer.place(VIEW)
    expect(layer.labelAt(atPixel(VIEW, 0, 100), 0, VIEW.zoom)).toBeNull()
  })

  it('lets resolveHit treat a label as a hit on its anchor id, after layers asked first', () => {
    const layer = layerFor(anchors)
    layer.place(VIEW)
    const coordinate = atPixel(VIEW, 0, 0)
    const none = { kind: 'point' as const, layer: { nearestPoint: () => null } }
    const dot = { kind: 'point' as const, layer: { nearestPoint: () => 7 } }

    expect(
      resolveHit({ coordinate, layers: [none, { kind: 'label', layer }], zoom: VIEW.zoom }),
    ).toEqual({ hit: { id: 28_641, index: 0, text: 'Mississippi River' }, kind: 'label' })
    expect(
      resolveHit({ coordinate, layers: [dot, { kind: 'label', layer }], zoom: VIEW.zoom }),
    ).toEqual({ hit: 7, kind: 'point' })
    expect(
      resolveHit({
        coordinate: atPixel(VIEW, 400, 300),
        layers: [{ kind: 'label', layer }],
        zoom: VIEW.zoom,
      }),
    ).toBeNull()
  })
})

describe('point layer obstaclesInView', () => {
  function gaugeLayer(points: Array<[number, number, number]>) {
    const positions = new Float64Array(points.length * 2)
    const classes = new Uint8Array(points.length)
    for (const [index, [longitude, latitude, byte]] of points.entries()) {
      positions[index * 2] = longitude
      positions[index * 2 + 1] = latitude
      classes[index] = byte
    }
    const style: PointClassTable = {
      [POINT_CLASS_NO_DATA]: { fill: '#aaa', order: 0, radius: 2, stroke: '#555' },
      [POINT_CLASS_NOT_REPORTING]: { fill: '#ccc', order: 1, radius: 2, stroke: '#777' },
      0: { fill: '#0a0', order: 2, radius: 3, stroke: '#050', strokeWidth: 2 },
    }
    return createPointLayer({
      classes,
      createCanvas: () => fakeCanvas() as never,
      positions,
      style,
    })
  }

  it('returns painted dots as screen circles, synchronously, and skips unstyled classes', () => {
    const near = atPixel(VIEW, 40, -20)
    const layer = gaugeLayer([
      [VIEW.longitude, VIEW.latitude, 0],
      [near.longitude, near.latitude, POINT_CLASS_NO_DATA],
      [near.longitude, near.latitude, 9],
    ])
    const circles = layer.obstaclesInView(VIEW)
    expect(circles).toHaveLength(2)
    expect(circles[0]?.x).toBeCloseTo(500, 6)
    expect(circles[0]?.y).toBeCloseTo(400, 6)
    expect(circles[0]?.radius).toBe(4)
    expect(circles[1]?.x).toBeCloseTo(540, 6)
    expect(circles[1]?.y).toBeCloseTo(380, 6)
    expect(circles[1]?.radius).toBe(2.5)
  })

  it('keeps dots inside the view and its margin only', () => {
    const outside = atPixel(VIEW, 700, 0)
    const edge = atPixel(VIEW, 520, 0)
    const layer = gaugeLayer([
      [outside.longitude, outside.latitude, 0],
      [edge.longitude, edge.latitude, 0],
    ])
    expect(layer.obstaclesInView(VIEW)).toHaveLength(0)
    expect(layer.obstaclesInView(VIEW, 30)).toHaveLength(1)
    expect(() => layer.obstaclesInView(VIEW, -1)).toThrow(RangeError)
  })

  it('feeds the label layer: a label never covers a gauge dot', () => {
    const dot = atPixel(VIEW, 12, 0)
    const gauges = gaugeLayer([[dot.longitude, dot.latitude, 0]])
    const placement = layerFor([anchorAt(VIEW, 0, 0, 'Mississippi River')], {
      obstacles: (view: LabelView) => gauges.obstaclesInView(view),
    }).place(VIEW)
    expect(placement.labels).toEqual([])
    expect(placement.stats.droppedByObstacle).toBe(1)
  })
})

/** Deterministic spread of named anchors over the view, no randomness. */
function scatter(count: number, view: LabelView = VIEW): LabelAnchor[] {
  const anchors: LabelAnchor[] = []
  for (let index = 0; index < count; index += 1) {
    const dx = ((index * 7919) % 1000) - 500
    const dy = ((index * 104_729) % 800) - 400
    anchors.push(
      anchorAt(view, dx, dy, `River ${index % 97}`, { id: index, priority: 4 + (index % 7) }),
    )
  }
  return anchors
}

describe('label layer: national budget', () => {
  it.each([
    ['dots everywhere', 1000],
    ['dots in the left third', 330],
  ])('places and paints a national view with %s inside the pinned work counts', (_name, spread) => {
    const view: LabelView = { ...VIEW, pixelRatio: 2, zoom: 4 }
    const anchors = scatter(LABEL_LAYER_NATIONAL_FRAME_BUDGET.anchors, view)
    const dotCount = LABEL_LAYER_NATIONAL_FRAME_BUDGET.obstacles
    const positions = new Float64Array(dotCount * 2)
    for (let index = 0; index < dotCount; index += 1) {
      const dot = atPixel(view, ((index * 6007) % spread) - 500, ((index * 7001) % 800) - 400)
      positions[index * 2] = dot.longitude
      positions[index * 2 + 1] = dot.latitude
    }
    const gauges = createPointLayer({
      classes: new Uint8Array(dotCount).fill(0),
      createCanvas: () => fakeCanvas() as never,
      positions,
      style: {
        [POINT_CLASS_NO_DATA]: { fill: '#aaa', order: 0, radius: 2, stroke: '#555' },
        [POINT_CLASS_NOT_REPORTING]: { fill: '#ccc', order: 1, radius: 2, stroke: '#777' },
        0: { fill: '#0a0', order: 2, radius: 3, stroke: '#050' },
      },
    })
    const layer = layerFor(anchors, { obstacles: (v: LabelView) => gauges.obstaclesInView(v) })
    const canvas = fakeCanvas()

    const started = performance.now()
    const placement = layer.paint(view, canvas)
    const elapsed = performance.now() - started
    const { stats } = placement
    const textCalls = canvas.calls.filter(
      (call) => call.op === 'strokeText' || call.op === 'fillText',
    ).length

    console.log(
      `label-layer national frame: ${placement.labels.length} labels, ${stats.considered} considered, ` +
        `${stats.overlapTests} overlap tests, ${stats.obstacles} obstacles, ${stats.measured} measured, ` +
        `${textCalls} text calls, ${elapsed.toFixed(1)}ms (informational, not asserted)`,
    )

    expect(placement.labels.length).toBeGreaterThan(0)
    expect(placement.labels.length).toBeLessThanOrEqual(LABEL_LAYER_DEFAULT_MAX_LABELS)
    expect(stats.obstacles).toBeLessThanOrEqual(LABEL_LAYER_NATIONAL_FRAME_BUDGET.obstacles)
    expect(stats.considered).toBeLessThanOrEqual(LABEL_LAYER_NATIONAL_FRAME_BUDGET.considered)
    expect(stats.overlapTests).toBeLessThanOrEqual(LABEL_LAYER_NATIONAL_FRAME_BUDGET.overlapTests)
    expect(textCalls).toBeLessThanOrEqual(LABEL_LAYER_NATIONAL_FRAME_BUDGET.textCalls)
    // Text is measured once per distinct string: 97 names, not one per anchor.
    expect(stats.measured).toBeLessThanOrEqual(97)

    // A second frame at the same view measures nothing and does the same work.
    const again = layer.place(view)
    expect(again.stats.measured).toBe(0)
    expect(again.stats.overlapTests).toBe(stats.overlapTests)
    expect(again.labels.map((label) => label.index)).toEqual(placement.labels.map((l) => l.index))

    // No label sits over a dot.
    const dots = gauges.obstaclesInView(view)
    let covered = 0
    for (const label of placement.labels) {
      for (const dot of dots) {
        const nearX = Math.min(
          label.x + label.width / 2,
          Math.max(label.x - label.width / 2, dot.x),
        )
        const nearY = Math.min(
          label.y + label.height / 2,
          Math.max(label.y - label.height / 2, dot.y),
        )
        if (Math.hypot(nearX - dot.x, nearY - dot.y) < dot.radius) covered += 1
      }
    }
    expect(covered).toBe(0)
  })
})
