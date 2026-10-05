/**
 * A pulse that travels along a path of stretches: which way the water flows.
 *
 * The desktop hover on the national river map lights a river, its path
 * downstream and its tributaries. This is the part of that picture that moves:
 * short dashes that run along the downstream path, in the direction the path
 * is listed. It draws on one canvas laid over the map, never in the network's
 * tile images, so it costs only what it draws and repaints nothing underneath.
 *
 * What it costs, by design:
 *
 * - Geometry is read when the path or the view changes, never per frame. The
 *   path's pieces come from decoded tiles already in memory
 *   ({@link FlowPulsePathSource.pathPieces}); neighbouring pieces are joined
 *   into a few long lines, so the dashes run unbroken across stretches.
 * - A frame is a clear and one stroke per line (a handful), with the dash
 *   pattern offset by the clock. It allocates nothing.
 * - The loop runs only while there is a path to draw and the map is still.
 *   `suspend()` stops it and clears the canvas while the map moves; `update()`
 *   starts it again for the settled view.
 *
 * With `prefers-reduced-motion`, nothing moves: the same path is drawn once as
 * small chevrons pointing the way the water goes.
 *
 * Nothing here knows what a stretch is. The caller lists feature ids with
 * their ground lengths, upstream first, and picks the colour.
 */
import { pixelsPerMeter } from './vector-tile-paths.js'

import type { PointLayerView } from './point-layer.js'
import type { VectorTilePathPiece, VectorTilePathStretch } from './vector-tile-paths.js'

/** How a pulse and its static chevrons are drawn. Lengths are CSS pixels. */
export interface FlowPulseStyle {
  /** Half the width of a chevron, from its tip to a wing's end. Default 4. */
  chevron?: number
  /** Distance between two chevrons along the path. Default 64. */
  chevronSpacing?: number
  color: string
  /** Length of one lit dash. Default 22. */
  dash?: number
  /** Default 1. */
  opacity?: number
  /** Distance from the start of one dash to the start of the next. Default 200. */
  period?: number
  /** How fast the dashes travel, in pixels a second. Default 125. */
  speed?: number
  /** Stroke width of a dash. */
  width: number
}

export const FLOW_PULSE_DEFAULTS = {
  chevron: 4,
  chevronSpacing: 64,
  dash: 22,
  opacity: 1,
  period: 200,
  speed: 125,
} as const

/** The slice of a vector tile source the pulse reads. */
export interface FlowPulsePathSource {
  pathPieces: (options: {
    marginPx?: number
    stretches: readonly VectorTilePathStretch[]
    view: PointLayerView
  }) => VectorTilePathPiece[]
}

export interface FlowPulseContext {
  lineCap: string
  lineDashOffset: number
  lineJoin: string
  lineWidth: number
  strokeStyle: string | object
  globalAlpha: number
  beginPath: () => void
  clearRect: (x: number, y: number, width: number, height: number) => void
  lineTo: (x: number, y: number) => void
  moveTo: (x: number, y: number) => void
  setLineDash: (segments: number[]) => void
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  stroke: (path?: unknown) => void
}

export interface FlowPulseCanvas {
  height: number
  style?: { height: string; width: string }
  width: number
  getContext: (contextId: '2d') => FlowPulseContext | null
}

export interface FlowPulseLayerOptions {
  /** The canvas laid over the map. The layer sizes it; the caller positions it. */
  canvas: FlowPulseCanvas
  cancelAnimationFrame?: (handle: number) => void
  /** Frame clock in milliseconds. Default `performance.now()`. */
  now?: () => number
  /** Device pixels per CSS pixel, read at each rebuild. Default `devicePixelRatio`, at most 2. */
  pixelRatio?: () => number
  /**
   * Whether to hold still. Default: the `prefers-reduced-motion: reduce` media
   * query, followed as it changes.
   */
  reducedMotion?: boolean
  requestAnimationFrame?: (callback: (time: number) => void) => number
  source: FlowPulsePathSource
  style: FlowPulseStyle
}

export type FlowPulseMode = 'chevrons' | 'idle' | 'pulse'

export interface FlowPulseStats {
  /** Lines the pieces were joined into. */
  chains: number
  /** Frames the loop has drawn since the layer was made. */
  frames: number
  mode: FlowPulseMode
  /** Points across every line. */
  points: number
}

export interface FlowPulseLayer {
  /** Stop, clear and release. Idempotent. */
  destroy: () => void
  /** The path to run along, upstream first, or `null` for none. */
  setPath: (stretches: readonly VectorTilePathStretch[] | null) => void
  setStyle: (style: FlowPulseStyle) => void
  readonly stats: FlowPulseStats
  /** The map is about to move: stop and clear. `update()` resumes. */
  suspend: () => void
  /** The map has settled on this view: read the geometry and draw. */
  update: (view: PointLayerView) => void
}

/** Pieces whose ends are this close, in CSS pixels, are one line. */
const JOIN_PX = 2.5
/** Pieces and lines this far past the view are still read. */
const MARGIN_PX = 48
/** Times an empty read is repeated, a beat apart, while tiles may still be decoding. */
const EMPTY_RETRIES = 3
const EMPTY_RETRY_MS = 350
const MAX_PIXEL_RATIO = 2

interface Chain {
  /** Cumulative length at each point, for chevron placement. */
  lengths: Float32Array
  /** Where the pattern starts along this line, in pixels, from the path's start. */
  phase: number
  points: Float32Array
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

function lengthsOf(points: Float32Array): Float32Array {
  const count = points.length / 2
  const lengths = new Float32Array(count)
  for (let index = 1; index < count; index += 1) {
    lengths[index] =
      (lengths[index - 1] as number) +
      Math.hypot(
        (points[index * 2] as number) - (points[index * 2 - 2] as number),
        (points[index * 2 + 1] as number) - (points[index * 2 - 1] as number),
      )
  }
  return lengths
}

/**
 * Join the pieces of a path, in path order, into lines: a piece that starts
 * where the last one ended continues it. A gap (a tile not decoded, a stretch
 * off the screen) starts a new line whose pattern phase comes from the ground
 * distance, so the dashes on the far side of a gap still line up with the
 * ones before it, to within the difference between ground and drawn length.
 */
export function joinPathPieces(
  pieces: readonly VectorTilePathPiece[],
  pixelsPerMetre: number,
): Chain[] {
  const chains: Chain[] = []
  let run: number[] = []
  let phase = 0
  let last = -1
  const flush = () => {
    if (run.length >= 4) {
      const points = new Float32Array(run)
      chains.push({ lengths: lengthsOf(points), phase, points })
    }
    run = []
  }
  for (const piece of pieces) {
    const { points } = piece
    if (points.length < 4) continue
    const startX = points[0] as number
    const startY = points[1] as number
    const joins =
      run.length >= 2 &&
      piece.rank >= last &&
      Math.hypot(
        startX - (run[run.length - 2] as number),
        startY - (run[run.length - 1] as number),
      ) <= JOIN_PX
    if (!joins) {
      flush()
      phase = piece.distanceM * pixelsPerMetre
    }
    // A joined piece's first point is the last one's end, within a pixel or two.
    for (let at = joins ? 2 : 0; at < points.length; at += 2) {
      run.push(points[at] as number, points[at + 1] as number)
    }
    last = piece.rank
  }
  flush()
  return chains
}

export function createFlowPulseLayer(options: FlowPulseLayerOptions): FlowPulseLayer {
  const { canvas, source } = options
  const requestFrame =
    options.requestAnimationFrame ??
    (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined)
  const cancelFrame =
    options.cancelAnimationFrame ??
    (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : undefined)
  const clock = options.now ?? (() => performance.now())

  const query =
    options.reducedMotion === undefined && typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
  const reduced = () => options.reducedMotion ?? query?.matches ?? false

  let style = options.style
  let stretches: readonly VectorTilePathStretch[] | null = null
  let view: PointLayerView | null = null
  let held = false
  let destroyed = false
  let chains: Chain[] = []
  let frame = 0
  let frames = 0
  let retries = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let pixelRatio = 1
  let dashPattern: number[] = []
  let mode: FlowPulseMode = 'idle'

  const value = <K extends keyof typeof FLOW_PULSE_DEFAULTS>(key: K): number =>
    (style[key] as number | undefined) ?? FLOW_PULSE_DEFAULTS[key]

  function context(): FlowPulseContext | null {
    return canvas.getContext('2d')
  }

  function clear() {
    const context2d = context()
    if (!context2d) return
    context2d.setTransform(1, 0, 0, 1, 0, 0)
    context2d.clearRect(0, 0, canvas.width, canvas.height)
    context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  }

  function stop() {
    if (frame && cancelFrame) cancelFrame(frame)
    frame = 0
  }

  function cancelRetry() {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }

  function strokeChain(context2d: FlowPulseContext, chain: Chain) {
    const { points } = chain
    context2d.beginPath()
    context2d.moveTo(points[0] as number, points[1] as number)
    for (let at = 2; at < points.length; at += 2) {
      context2d.lineTo(points[at] as number, points[at + 1] as number)
    }
    context2d.stroke()
  }

  function configure(context2d: FlowPulseContext) {
    context2d.strokeStyle = style.color
    context2d.lineWidth = style.width
    context2d.globalAlpha = value('opacity')
    context2d.lineCap = 'round'
    context2d.lineJoin = 'round'
    const dash = value('dash')
    const period = Math.max(value('period'), dash + 1)
    dashPattern = [dash, period - dash]
  }

  /** The moving dashes, one frame. No allocation: a clear, an offset and a stroke per line. */
  function paintPulse(time: number) {
    const context2d = context()
    if (!context2d || !view) return
    context2d.clearRect(0, 0, view.width, view.height)
    const period = dashPattern[0]! + dashPattern[1]!
    const travelled = (time / 1000) * value('speed')
    for (const chain of chains) {
      context2d.lineDashOffset = positiveModulo(chain.phase - travelled, period)
      strokeChain(context2d, chain)
    }
  }

  function loop(time: number) {
    frame = 0
    if (destroyed || held || mode !== 'pulse') return
    frames += 1
    paintPulse(time)
    if (requestFrame) frame = requestFrame(loop)
  }

  /** Chevrons along every line, once: the same path, held still. */
  function paintChevrons() {
    const context2d = context()
    if (!context2d || !view) return
    context2d.clearRect(0, 0, view.width, view.height)
    context2d.setLineDash([])
    const spacing = value('chevronSpacing')
    const size = value('chevron')
    context2d.beginPath()
    for (const chain of chains) {
      const { lengths, phase, points } = chain
      const total = lengths[lengths.length - 1] as number
      let segment = 1
      for (
        let along = positiveModulo(spacing / 2 - phase, spacing);
        along < total;
        along += spacing
      ) {
        while (segment < lengths.length - 1 && (lengths[segment] as number) < along) segment += 1
        const from = segment - 1
        const span = (lengths[segment] as number) - (lengths[from] as number)
        if (!(span > 0)) continue
        const t = (along - (lengths[from] as number)) / span
        const ax = points[from * 2] as number
        const ay = points[from * 2 + 1] as number
        const bx = points[segment * 2] as number
        const by = points[segment * 2 + 1] as number
        const tipX = ax + (bx - ax) * t
        const tipY = ay + (by - ay) * t
        // Unit vector back along the line, then the two wings at 35 degrees to it.
        const backX = (ax - bx) / span
        const backY = (ay - by) / span
        const cos = Math.cos(0.61)
        const sin = Math.sin(0.61)
        context2d.moveTo(
          tipX + size * (backX * cos - backY * sin),
          tipY + size * (backX * sin + backY * cos),
        )
        context2d.lineTo(tipX, tipY)
        context2d.lineTo(
          tipX + size * (backX * cos + backY * sin),
          tipY + size * (-backX * sin + backY * cos),
        )
      }
    }
    context2d.stroke()
  }

  function resize(next: PointLayerView) {
    const wanted = Math.min(options.pixelRatio?.() ?? globalDevicePixelRatio(), MAX_PIXEL_RATIO)
    pixelRatio = wanted > 0 ? wanted : 1
    const width = Math.max(1, Math.round(next.width * pixelRatio))
    const height = Math.max(1, Math.round(next.height * pixelRatio))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    if (canvas.style) {
      canvas.style.width = `${next.width}px`
      canvas.style.height = `${next.height}px`
    }
    const context2d = context()
    context2d?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  }

  function rebuild() {
    stop()
    cancelRetry()
    chains = []
    if (destroyed || held || !view || !stretches || stretches.length === 0) {
      mode = 'idle'
      if (view) {
        resize(view)
        clear()
      }
      return
    }
    resize(view)
    clear()
    const pieces = source.pathPieces({ marginPx: MARGIN_PX, stretches, view })
    chains = joinPathPieces(pieces, pixelsPerMeter(view))
    if (chains.length === 0) {
      mode = 'idle'
      if (retries < EMPTY_RETRIES) {
        retries += 1
        retryTimer = setTimeout(() => {
          retryTimer = null
          rebuild()
        }, EMPTY_RETRY_MS)
      }
      return
    }
    retries = 0
    const context2d = context()
    if (!context2d) {
      mode = 'idle'
      return
    }
    configure(context2d)
    if (reduced() || !requestFrame) {
      mode = 'chevrons'
      paintChevrons()
      return
    }
    mode = 'pulse'
    context2d.setLineDash(dashPattern)
    paintPulse(clock())
    frame = requestFrame(loop)
  }

  const onMotionChange = () => {
    if (!destroyed && !held && view) rebuild()
  }
  query?.addEventListener('change', onMotionChange)

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      stop()
      cancelRetry()
      query?.removeEventListener('change', onMotionChange)
      chains = []
      mode = 'idle'
      if (view) clear()
    },
    setPath(next) {
      stretches = next && next.length > 0 ? next : null
      retries = 0
      rebuild()
    },
    setStyle(next) {
      style = next
      if (!destroyed && !held && view) rebuild()
    },
    get stats() {
      let points = 0
      for (const chain of chains) points += chain.points.length / 2
      return { chains: chains.length, frames, mode, points }
    },
    suspend() {
      if (destroyed) return
      held = true
      stop()
      cancelRetry()
      mode = 'idle'
      if (view) clear()
    },
    update(next) {
      view = next
      held = false
      retries = 0
      rebuild()
    },
  }
}

function globalDevicePixelRatio(): number {
  return typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
}
