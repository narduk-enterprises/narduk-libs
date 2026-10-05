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
  | {
      op: 'stroke'
      alpha: number
      dashOffset: number
      dash: number[]
      lineWidth: number
      path: unknown
      strokeStyle: string
    }
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
    stroke: (path) =>
      calls.push({
        alpha: context.globalAlpha,
        dash,
        dashOffset: context.lineDashOffset,
        lineWidth: context.lineWidth,
        op: 'stroke',
        path,
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

  it('runs a comet train down the line: the head last, every pass sharing it, the offset moving with the clock', () => {
    const { canvas, frames, layer, pathPieces, strokes, tick } = harness(
      { style: { color: '#0f3e62', dash: 22, period: 48, tail: 3, width: 3 } },
      LINE,
    )
    layer.setPath(PATH)
    layer.update(VIEW)

    expect(layer.stats.mode).toBe('pulse')
    expect(layer.stats.chains).toBe(1)
    // The canvas is sized in device pixels and laid out in CSS pixels.
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(800)
    expect(canvas.style).toEqual({ height: '400px', width: '600px' })
    // Three tail steps with no halo: long and faint, then shorter, wider and brighter, the head.
    const frame = strokes().slice(-3)
    const dashes = frame.map((call) => (call as { dash: number[] }).dash)
    expect(dashes[0]).toEqual([22, 26])
    expect(dashes[1]![0]).toBeCloseTo(22 * (2 / 3), 6)
    expect(dashes[2]![0]).toBeCloseTo(22 / 3, 6)
    for (const dash of dashes) expect(dash[0]! + dash[1]!).toBeCloseTo(48, 6)
    const widths = frame.map((call) => (call as { lineWidth: number }).lineWidth)
    expect(widths[0]).toBeLessThan(widths[1]!)
    expect(widths[1]).toBeLessThan(widths[2]!)
    expect(widths[2]).toBe(3)
    const alphas = frame.map((call) => (call as { alpha: number }).alpha)
    expect(alphas[0]).toBeLessThan(alphas[1]!)
    expect(alphas[2]).toBe(1)
    // Every pass ends at the same place along the line: start + length is the same.
    const heads = frame.map(
      (call) =>
        (((call as { dash: number[] }).dash[0]! - (call as { dashOffset: number }).dashOffset) %
          48) +
        48,
    )
    for (const head of heads) expect(head % 48).toBeCloseTo(heads[0]! % 48, 6)

    const before = strokes().length
    tick(1000)
    tick(1016)
    const offsets = strokes()
      .slice(before)
      .filter((_, index) => index % 3 === 2)
      .map((call) => (call as { dashOffset: number }).dashOffset)
    // 90 px a second: the pattern slides back 1.44 px in 16 ms, so the streaks slide forward.
    expect(offsets).toHaveLength(2)
    expect(offsets[0]! - offsets[1]!).toBeCloseTo(1.44, 6)
    expect(frames).toHaveLength(1)
    // The geometry was read once; frames only move the offset.
    expect(pathPieces).toHaveBeenCalledTimes(1)
    expect(layer.stats.frames).toBe(2)
  })

  it('draws a halo first when the style has one, wider and fainter than the head', () => {
    const { strokes } = (() => {
      const h = harness({ style: { color: '#fff', glowColor: '#0a2233', tail: 3, width: 3 } }, LINE)
      h.layer.setPath(PATH)
      h.layer.update(VIEW)
      return h
    })()
    const frame = strokes().slice(-4)
    expect(frame[0]).toMatchObject({ strokeStyle: '#0a2233', lineWidth: 3 * 1.8 })
    expect((frame[0] as { alpha: number }).alpha).toBeLessThan(1)
    expect(frame[3]).toMatchObject({ strokeStyle: '#fff', lineWidth: 3, alpha: 1 })
  })

  it('draws four tail steps, lit head last, with the defaults', () => {
    const { layer, strokes } = harness({ style: { color: '#fff', width: 3 } }, LINE)
    layer.setPath(PATH)
    layer.update(VIEW)
    expect(strokes()).toHaveLength(4)
    expect(strokes().map((call) => (call as { dash: number[] }).dash[0]!)).toEqual([
      30, 22.5, 15, 7.5,
    ])
  })

  it('is a plain dash with a tail of one step', () => {
    const { strokes, layer } = harness({ style: { color: '#fff', tail: 1, width: 3 } }, LINE)
    layer.setPath(PATH)
    layer.update(VIEW)
    expect(strokes()).toHaveLength(1)
    expect(strokes()[0]).toMatchObject({ dash: [30, 26], lineWidth: 3, alpha: 1 })
  })

  it('keeps a line as a path and replays it each frame when the platform has paths', () => {
    const made: Array<{ points: number[] }> = []
    const { layer, strokes, tick } = harness(
      {
        createPath: () => {
          const path = { points: [] as number[] }
          made.push(path)
          return Object.assign(path, {
            lineTo: (x: number, y: number) => path.points.push(x, y),
            moveTo: (x: number, y: number) => path.points.push(x, y),
          })
        },
      },
      LINE,
    )
    layer.setPath(PATH)
    layer.update(VIEW)
    expect(made).toHaveLength(1)
    expect(made[0]?.points).toEqual([10, 200, 300, 200, 590, 100])
    tick(500)
    tick(516)
    for (const call of strokes()) expect((call as { path: unknown }).path).toBe(made[0])
    // Built once, however many frames.
    expect(made).toHaveLength(1)
  })

  it('keeps every dash offset inside one period', () => {
    const { layer, strokes, tick } = harness({}, LINE)
    layer.setPath(PATH)
    layer.update(VIEW)
    for (let at = 0; at < 20_000; at += 1700) tick(at)
    for (const call of strokes()) {
      const offset = (call as { dashOffset: number }).dashOffset
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(56)
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
    layer.setStyle({ color: '#c3e2f3', dash: 10, period: 80, tail: 1, width: 5 })
    expect(strokes().at(-1)).toMatchObject({
      dash: [10, 70],
      lineWidth: 5,
      strokeStyle: '#c3e2f3',
    })
  })

  describe('tributary streaks', () => {
    const BRANCHES = [
      { opacity: 0.9, stretches: [{ id: 200, meters: 1000 }] },
      { opacity: 0.3, stretches: [{ id: 300, meters: 1000 }] },
    ]
    const TRIBS = [
      { distanceM: 0, id: 200, points: new Float32Array([0, 50, 100, 60]), rank: 0 },
      { distanceM: 0, id: 300, points: new Float32Array([200, 50, 300, 60]), rank: 1 },
    ]

    it('reads the branches in the same pass, groups them by brightness and draws them fainter and thinner', () => {
      const { layer, pathPieces, strokes } = harness({}, LINE)
      pathPieces.mockImplementation(((options: { stretches: Array<{ id: number }> }) =>
        options.stretches[0]?.id === 200 ? TRIBS : LINE) as never)
      layer.setPath(PATH, BRANCHES)
      layer.update(VIEW)
      expect(layer.stats).toMatchObject({ branchChains: 2, chains: 1, mode: 'pulse' })
      // One read of the main path, one of every tributary together.
      expect(pathPieces).toHaveBeenCalledTimes(2)
      const frame = strokes().slice(-6)
      // Two brightness groups, each on its own start phase, then the four passes of the main line.
      const branch = frame.slice(0, 2) as Array<{ alpha: number; lineWidth: number }>
      expect(branch[0]!.alpha).toBeCloseTo(0.85 * 0.9, 6)
      expect(branch[1]!.alpha).toBeCloseTo(0.85 * 0.3, 6)
      expect(branch[0]!.lineWidth).toBeLessThan(3)
      expect(branch[0]!.lineWidth).toBeGreaterThanOrEqual(1.4)
    })

    it('spreads the lines of a brightness over start phases so they do not march together', () => {
      const lines = Array.from({ length: 8 }, (_, index) => ({
        distanceM: index * 1000,
        id: 200 + index,
        points: new Float32Array([0, index * 20, 50, index * 20 + 5]),
        rank: index,
      }))
      const { layer, pathPieces, strokes } = harness({
        style: { color: '#fff', tail: 1, width: 3 },
      })
      pathPieces.mockImplementation((() => lines) as never)
      layer.setPath(null, [
        { opacity: 1, stretches: lines.map((line) => ({ id: line.id, meters: 1000 })) },
      ])
      layer.update(VIEW)
      expect(layer.stats).toMatchObject({ branchChains: 8, chains: 0, mode: 'pulse' })
      const offsets = strokes().map((call) => (call as { dashOffset: number }).dashOffset)
      expect(new Set(offsets.map((offset) => offset.toFixed(3))).size).toBe(4)
    })

    it('holds still with reduced motion: chevrons on the main path only', () => {
      const { layer, pathPieces, strokes } = harness({ reducedMotion: true }, LINE)
      pathPieces.mockImplementation(((options: { stretches: Array<{ id: number }> }) =>
        options.stretches[0]?.id === 200 ? TRIBS : LINE) as never)
      layer.setPath(PATH, BRANCHES)
      layer.update(VIEW)
      expect(layer.stats.mode).toBe('chevrons')
      expect(strokes()).toHaveLength(1)
    })

    it('clears with the path', () => {
      const { frames, layer, pathPieces } = harness({}, LINE)
      pathPieces.mockImplementation((() => TRIBS) as never)
      layer.setPath(PATH, BRANCHES)
      layer.update(VIEW)
      layer.setPath(null)
      expect(frames).toHaveLength(0)
      expect(layer.stats).toMatchObject({ branchChains: 0, chains: 0, mode: 'idle' })
    })
  })
})
