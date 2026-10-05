import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFlowPulseLayer, joinPathPieces } from '../src/client/index.js'

import type {
  FlowPulseCanvas,
  FlowPulseContext,
  FlowPulseLayerOptions,
  PointLayerView,
  VectorTilePathPiece,
} from '../src/client/index.js'

const VIEW: PointLayerView = { height: 400, latitude: 38, longitude: -90, width: 600, zoom: 6 }

function piece(
  rank: number,
  distanceM: number,
  ...points: Array<[number, number]>
): VectorTilePathPiece {
  return { distanceM, id: rank + 100, points: new Float32Array(points.flat()), rank }
}

type Call =
  | { op: 'clearRect' | 'lineTo' | 'moveTo'; args: number[] }
  | { op: 'stroke'; dashOffset: number; dash: number[]; lineWidth: number; strokeStyle: string }
  | { op: 'setLineDash'; args: number[] }
  | { op: 'setTransform'; args: number[] }

function fakeCanvas() {
  const calls: Call[] = []
  let dash: number[] = []
  const context: FlowPulseContext = {
    globalAlpha: 1,
    lineCap: '',
    lineDashOffset: 0,
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    beginPath: () => {},
    clearRect: (...args) => calls.push({ args, op: 'clearRect' }),
    lineTo: (...args) => calls.push({ args, op: 'lineTo' }),
    moveTo: (...args) => calls.push({ args, op: 'moveTo' }),
    setLineDash: (segments) => {
      dash = segments
      calls.push({ args: segments, op: 'setLineDash' })
    },
    setTransform: (...args) => calls.push({ args, op: 'setTransform' }),
    stroke: () =>
      calls.push({
        dash,
        dashOffset: context.lineDashOffset,
        lineWidth: context.lineWidth,
        op: 'stroke',
        strokeStyle: String(context.strokeStyle),
      }),
  }
  const canvas: FlowPulseCanvas = {
    height: 0,
    style: { height: '', width: '' },
    width: 0,
    getContext: () => context,
  }
  return { calls, canvas, context }
}

function harness(extra: Partial<FlowPulseLayerOptions> = {}, pieces: VectorTilePathPiece[] = []) {
  const { calls, canvas, context } = fakeCanvas()
  let time = 0
  const frames: Array<(time: number) => void> = []
  const pathPieces = vi.fn(() => pieces)
  const layer = createFlowPulseLayer({
    canvas,
    cancelAnimationFrame: () => {
      frames.length = 0
    },
    now: () => time,
    pixelRatio: () => 2,
    reducedMotion: false,
    requestAnimationFrame: (callback) => frames.push(callback),
    source: { pathPieces },
    style: { color: '#0f3e62', width: 3 },
    ...extra,
  })
  /** Run the queued frame at `at` milliseconds. */
  const tick = (at: number) => {
    time = at
    const next = frames.shift()
    next?.(at)
  }
  const strokes = () => calls.filter((call) => call.op === 'stroke')
  return { calls, canvas, context, frames, layer, pathPieces, strokes, tick }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('joinPathPieces', () => {
  it('joins pieces that meet, and starts a new line, with its own phase, at a gap', () => {
    const chains = joinPathPieces(
      [
        piece(0, 0, [0, 0], [100, 0]),
        piece(1, 1000, [101, 1], [200, 0]),
        piece(2, 5000, [500, 0], [600, 0]),
      ],
      0.1,
    )
    expect(chains).toHaveLength(2)
    // The first two meet within a pixel and are one line; the duplicate start is dropped.
    expect(Array.from(chains[0]?.points ?? [])).toEqual([0, 0, 100, 0, 200, 0])
    expect(chains[0]?.phase).toBe(0)
    // The far piece's pattern phase is its ground distance, in pixels.
    expect(chains[1]?.phase).toBeCloseTo(500, 6)
  })

  it('does not join a piece that goes back up the path', () => {
    const chains = joinPathPieces(
      [piece(3, 300, [0, 0], [100, 0]), piece(1, 100, [100, 0], [200, 0])],
      1,
    )
    expect(chains).toHaveLength(2)
  })

  it('drops a piece of fewer than two points', () => {
    expect(joinPathPieces([piece(0, 0, [0, 0])], 1)).toEqual([])
  })
})

describe('createFlowPulseLayer', () => {
  const PATH = [{ id: 100, meters: 2000 }]
  const LINE = [piece(0, 0, [10, 200], [300, 200], [590, 100])]

  it('runs dashes down the line: one stroke a frame, the offset moving with the clock', () => {
    const { canvas, frames, layer, pathPieces, strokes, tick } = harness({}, LINE)
    layer.setPath(PATH)
    layer.update(VIEW)

    expect(layer.stats.mode).toBe('pulse')
    expect(layer.stats.chains).toBe(1)
    // The canvas is sized in device pixels and laid out in CSS pixels.
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(800)
    expect(canvas.style).toEqual({ height: '400px', width: '600px' })
    const first = strokes().at(-1)
    expect(first).toMatchObject({ dash: [22, 178], lineWidth: 3, strokeStyle: '#0f3e62' })

    const before = strokes().length
    tick(1000)
    tick(1016)
    const offsets = strokes()
      .slice(before)
      .map((call) => (call as { dashOffset: number }).dashOffset)
    // 125 px a second: the pattern slides back 2 px in 16 ms, so the dashes slide forward.
    expect(offsets).toHaveLength(2)
    expect(offsets[0]! - offsets[1]!).toBeCloseTo(2, 6)
    expect(frames).toHaveLength(1)
    // The geometry was read once; frames only move the offset.
    expect(pathPieces).toHaveBeenCalledTimes(1)
    expect(layer.stats.frames).toBe(2)
  })

  it('keeps every dash offset inside one period', () => {
    const { layer, strokes, tick } = harness({}, LINE)
    layer.setPath(PATH)
    layer.update(VIEW)
    for (let at = 0; at < 20_000; at += 1700) tick(at)
    for (const call of strokes()) {
      const offset = (call as { dashOffset: number }).dashOffset
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(200)
    }
  })

  it('stops on suspend and clears; update starts it again', () => {
    const { calls, frames, layer, pathPieces, tick } = harness({}, LINE)
    layer.setPath(PATH)
    layer.update(VIEW)
    tick(10)
    layer.suspend()
    expect(frames).toHaveLength(0)
    expect(layer.stats.mode).toBe('idle')
    expect(calls.at(-1)).toMatchObject({ op: 'setTransform' })
    const frameCount = layer.stats.frames
    tick(30)
    expect(layer.stats.frames).toBe(frameCount)

    layer.update(VIEW)
    expect(layer.stats.mode).toBe('pulse')
    expect(pathPieces).toHaveBeenCalledTimes(2)
    expect(frames).toHaveLength(1)
  })

  it('draws nothing for no path, and the clear leaves no loop behind', () => {
    const { frames, layer, pathPieces } = harness({}, LINE)
    layer.update(VIEW)
    expect(layer.stats.mode).toBe('idle')
    layer.setPath(PATH)
    expect(frames).toHaveLength(1)
    layer.setPath(null)
    expect(frames).toHaveLength(0)
    expect(layer.stats).toMatchObject({ chains: 0, mode: 'idle' })
    expect(pathPieces).toHaveBeenCalledTimes(1)
  })

  it('holds still with reduced motion: chevrons pointing downstream, no loop', () => {
    const { calls, frames, layer, strokes } = harness({ reducedMotion: true }, LINE)
    layer.setPath(PATH)
    layer.update(VIEW)
    expect(layer.stats.mode).toBe('chevrons')
    expect(frames).toHaveLength(0)
    // All the chevrons in one stroke, undashed.
    expect(strokes()).toHaveLength(1)
    expect(strokes()[0]).toMatchObject({ dash: [] })

    // Every chevron is three points: wing, tip, wing. The line runs west to east at first, so
    // each wing is west of its tip.
    const moves = calls.filter((call) => call.op === 'moveTo')
    const lines = calls.filter((call) => call.op === 'lineTo')
    expect(moves.length).toBeGreaterThan(3)
    expect(lines).toHaveLength(moves.length * 2)
    const firstWing = (moves[0] as { args: number[] }).args
    const firstTip = (lines[0] as { args: number[] }).args
    expect(firstWing[0]!).toBeLessThan(firstTip[0]!)
  })

  it('switches to chevrons when the visitor turns reduced motion on', () => {
    const listeners: Array<() => void> = []
    const preference = { matches: false }
    vi.stubGlobal('matchMedia', () => ({
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      get matches() {
        return preference.matches
      },
      removeEventListener: () => {},
    }))
    try {
      const { frames, layer } = harness({ reducedMotion: undefined as never }, LINE)
      layer.setPath(PATH)
      layer.update(VIEW)
      expect(layer.stats.mode).toBe('pulse')
      expect(listeners).toHaveLength(1)

      preference.matches = true
      listeners[0]?.()
      expect(layer.stats.mode).toBe('chevrons')
      expect(frames).toHaveLength(0)

      preference.matches = false
      listeners[0]?.()
      expect(layer.stats.mode).toBe('pulse')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('tries again a beat later when the tiles were not there, and gives up after a few', () => {
    vi.useFakeTimers()
    const pieces: VectorTilePathPiece[][] = [[], [], LINE]
    const { layer, pathPieces } = harness({})
    pathPieces.mockImplementation(() => pieces.shift() ?? [])
    layer.setPath(PATH)
    layer.update(VIEW)
    expect(layer.stats.mode).toBe('idle')
    vi.advanceTimersByTime(350)
    expect(pathPieces).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(350)
    expect(pathPieces).toHaveBeenCalledTimes(3)
    expect(layer.stats.mode).toBe('pulse')

    pathPieces.mockImplementation(() => [])
    layer.update(VIEW)
    vi.advanceTimersByTime(10_000)
    // The first read plus three retries, then it stops asking.
    expect(pathPieces).toHaveBeenCalledTimes(3 + 4)
  })

  it('stops for good on destroy', () => {
    const { frames, layer, pathPieces, tick } = harness({}, LINE)
    layer.setPath(PATH)
    layer.update(VIEW)
    layer.destroy()
    layer.destroy()
    tick(5)
    expect(frames).toHaveLength(0)
    layer.update(VIEW)
    layer.setPath(PATH)
    expect(pathPieces).toHaveBeenCalledTimes(1)
  })

  it('reads a new style on the next rebuild', () => {
    const { layer, strokes } = harness({}, LINE)
    layer.setPath(PATH)
    layer.update(VIEW)
    layer.setStyle({ color: '#c3e2f3', dash: 10, period: 80, width: 5 })
    expect(strokes().at(-1)).toMatchObject({
      dash: [10, 70],
      lineWidth: 5,
      strokeStyle: '#c3e2f3',
    })
  })
})
