/**
 * Streaks that travel along a path of stretches: which way the water flows.
 *
 * The desktop hover on the national river map lights a river, its path
 * downstream and its tributaries. This is the part of that picture that moves:
 * a train of bright comet streaks, evenly spaced, running along the path in the
 * direction it is listed, with fainter streaks on any tributaries. It draws on
 * one canvas laid over the map, never in the network's tile images, so it costs
 * only what it draws and repaints nothing underneath.
 *
 * A streak is a bright head with a tail that fades away behind it, over an
 * optional halo of a second colour: the head reads against a dark river
 * because it is light, and against a light one because the halo is dark.
 *
 * What it costs, by design:
 *
 * - Geometry is read when the path or the view changes, never per frame. The
 *   path's pieces come from decoded tiles already in memory
 *   ({@link FlowPulsePathSource.pathPieces}); neighbouring pieces are joined
 *   into a few long lines, so the dashes run unbroken across stretches.
 * - Each line is built once into a `Path2D` (when the platform has one). A
 *   frame is a clear and a few strokes per line, with the dash pattern offset
 *   by the clock. Tributaries are batched by brightness into a stroke or two
 *   each, however many stretches they hold. It allocates nothing.
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

/** How the streaks and their static chevrons are drawn. Lengths are CSS pixels. */
export interface FlowPulseStyle {
  /** Brightness of the tributary streaks against the main ones, 0 to 1. Default 0.85. */
  branchOpacity?: number
  /** Stroke width of a tributary streak. Default `width * 0.6`, at least 1.4. */
  branchWidth?: number
  /** Half the width of a chevron, from its tip to a wing's end. Default 4. */
  chevron?: number
  /** Distance between two chevrons along the path. Default 64. */
  chevronSpacing?: number
  /** The streak head's colour; the tail is the same colour, fainter. */
  color: string
  /** Length of one streak, head to the end of its tail. Default 30. */
  dash?: number
  /** Colour of the halo under each streak. Default: no halo. */
  glowColor?: string
  /** Brightness of the halo, 0 to 1. Default 0.45. */
  glowOpacity?: number
  /** Halo width as a multiple of `width`. Default 1.8. */
  glowScale?: number
  /** Default 1. */
  opacity?: number
  /** Distance from the start of one streak to the start of the next. Default 56. */
  period?: number
  /** How fast the streaks travel, in pixels a second. Default 90. */
  speed?: number
  /** Steps in a streak's tail, from the bright head back to its faint end; 1 is a plain dash. Default 4. */
  tail?: number
  /** Stroke width of a streak head. */
  width: number
}

export const FLOW_PULSE_DEFAULTS = {
  branchOpacity: 0.85,
  chevron: 4,
  chevronSpacing: 64,
  dash: 30,
  glowOpacity: 0.45,
  glowScale: 1.8,
  opacity: 1,
  period: 56,
  speed: 90,
  tail: 4,
} as const

/** Tributaries of one brightness: stretches listed upstream first within each line. */
export interface FlowPulseBranch {
  /** How bright this group is, 0 to 1, before the style's `branchOpacity`. */
  opacity: number
  /** Stretches of this group. Lines (a tributary and what feeds it) are listed upstream first. */
  stretches: readonly VectorTilePathStretch[]
}

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
  stroke: (path?: FlowPulsePath) => void
}

/** What a built line is: a `Path2D`, or anything a context can stroke. */
export type FlowPulsePath = object

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
  /**
   * Builds the object a line is kept in between frames. Default: `new Path2D()`
   * where the platform has it; without one, each frame draws the line afresh.
   */
  createPath?: () => (FlowPulsePath & FlowPulsePathBuilder) | null
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

/** The part of `Path2D` the layer uses. */
export interface FlowPulsePathBuilder {
  lineTo: (x: number, y: number) => void
  moveTo: (x: number, y: number) => void
}

export type FlowPulseMode = 'chevrons' | 'idle' | 'pulse'

export interface FlowPulseStats {
  /** Lines of tributary streaks. */
  branchChains: number
  /** Lines the pieces of the main path were joined into. */
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
  /**
   * The path to run along, upstream first, or `null` for none, and optionally
   * fainter streaks on tributaries, which run the way their lines are drawn.
   * One call reads the geometry once; `null` and no branches clears it all.
   */
  setPath: (
    stretches: readonly VectorTilePathStretch[] | null,
    branches?: readonly FlowPulseBranch[] | null,
  ) => void
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
  /** The line kept for stroking, when the platform can. */
  path?: FlowPulsePath
  points: Float32Array
}

/** A tributary line, kept as a path for stroking. */
interface BranchGroup {
  /** The brightness of the group's streaks, before the style's `branchOpacity`. */
  opacity: number
  /** How many lines the group holds. */
  count: number
  /** The lines of this group and one start phase, as one path. */
  path: FlowPulsePath | null
  /** Where in the period this set of lines starts, as a share of it. */
  shift: number
  /** Without `Path2D`: the points to draw each frame. */
  lines: Float32Array[]
}

/** Tributary lines of a group are spread over this many start phases, so they do not march together. */
const BRANCH_PHASES = 4

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

interface Pass {
  alpha: number
  color: string
  length: number
  width: number
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
  const createPath =
    options.createPath ??
    (typeof Path2D === 'function'
      ? () => new Path2D() as FlowPulsePath & FlowPulsePathBuilder
      : null)

  const query =
    options.reducedMotion === undefined && typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
  const reduced = () => options.reducedMotion ?? query?.matches ?? false

  let style = options.style
  let stretches: readonly VectorTilePathStretch[] | null = null
  let branches: readonly FlowPulseBranch[] | null = null
  let view: PointLayerView | null = null
  let held = false
  let destroyed = false
  let chains: Chain[] = []
  let groups: BranchGroup[] = []
  let branchChains = 0
  let frame = 0
  let frames = 0
  let retries = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let pixelRatio = 1
  let passes: Pass[] = []
  let branchPass: Pass = { alpha: 1, color: '', length: 1, width: 1 }
  let period = FLOW_PULSE_DEFAULTS.period as number
  let speed = FLOW_PULSE_DEFAULTS.speed as number
  let dash = FLOW_PULSE_DEFAULTS.dash as number
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

  function traceLine(target: Pick<FlowPulseContext, 'lineTo' | 'moveTo'>, points: Float32Array) {
    target.moveTo(points[0] as number, points[1] as number)
    for (let at = 2; at < points.length; at += 2) {
      target.lineTo(points[at] as number, points[at + 1] as number)
    }
  }

  function strokeChain(context2d: FlowPulseContext, chain: Chain) {
    if (chain.path) {
      context2d.stroke(chain.path)
      return
    }
    context2d.beginPath()
    traceLine(context2d, chain.points)
    context2d.stroke()
  }

  /** Read the style into the passes a frame draws: a halo, then the tail steps, head last. */
  function configure() {
    dash = Math.max(value('dash'), 2)
    period = Math.max(value('period'), dash + 2)
    speed = value('speed')
    const width = style.width
    const opacity = value('opacity')
    passes = []
    if (style.glowColor) {
      passes.push({
        alpha: value('glowOpacity') * opacity,
        color: style.glowColor,
        length: dash,
        width: width * value('glowScale'),
      })
    }
    const steps = Math.max(1, Math.round(value('tail')))
    for (let step = 0; step < steps; step += 1) {
      const strength = steps === 1 ? 1 : step / (steps - 1)
      passes.push({
        alpha: opacity * (steps === 1 ? 1 : 0.28 + 0.72 * strength),
        color: style.color,
        length: dash * (1 - step / steps),
        width: steps === 1 ? width : width * (0.55 + 0.45 * strength),
      })
    }
    branchPass = {
      alpha: opacity * value('branchOpacity'),
      color: style.color,
      length: Math.max(6, dash * 0.65),
      width: style.branchWidth ?? Math.max(1.4, width * 0.6),
    }
  }

  /** Tributary streaks: plain dashes, a stroke for each brightness and start phase. */
  function paintBranches(context2d: FlowPulseContext, travelled: number) {
    if (groups.length === 0) return
    context2d.strokeStyle = branchPass.color
    context2d.lineWidth = branchPass.width
    context2d.setLineDash([branchPass.length, period - branchPass.length])
    for (const group of groups) {
      context2d.globalAlpha = Math.min(1, branchPass.alpha * group.opacity)
      context2d.lineDashOffset = positiveModulo(-(travelled + group.shift * period), period)
      if (group.path) {
        context2d.stroke(group.path)
        continue
      }
      context2d.beginPath()
      for (const line of group.lines) traceLine(context2d, line)
      context2d.stroke()
    }
  }

  /** The moving streaks, one frame. No allocation: a clear, an offset and a stroke per line and pass. */
  function paintPulse(time: number) {
    const context2d = context()
    if (!context2d || !view) return
    context2d.clearRect(0, 0, view.width, view.height)
    const travelled = (time / 1000) * speed
    paintBranches(context2d, travelled)
    for (const pass of passes) {
      context2d.strokeStyle = pass.color
      context2d.lineWidth = pass.width
      context2d.globalAlpha = pass.alpha
      context2d.setLineDash([pass.length, period - pass.length])
      for (const chain of chains) {
        // The head sits at the downstream end of the streak; every pass shares it.
        const head = travelled - chain.phase + dash
        context2d.lineDashOffset = positiveModulo(pass.length - head, period)
        strokeChain(context2d, chain)
      }
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
    context2d.lineCap = 'round'
    context2d.lineJoin = 'round'
    if (style.glowColor) {
      context2d.strokeStyle = style.glowColor
      context2d.lineWidth = style.width * 1.9
      context2d.globalAlpha = value('glowOpacity') * value('opacity')
      context2d.stroke()
    }
    context2d.strokeStyle = style.color
    context2d.lineWidth = style.width
    context2d.globalAlpha = value('opacity')
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

  /** Keep each main line as a path, so a frame replays it instead of tracing it. */
  function keepPaths(lines: Chain[]) {
    if (!createPath) return
    for (const chain of lines) {
      const path = createPath()
      if (!path) return
      traceLine(path, chain.points)
      chain.path = path
    }
  }

  /** Read the tributary pieces and gather their lines into a path per brightness and start phase. */
  function buildBranches(pixelsPerMetre: number) {
    groups = []
    branchChains = 0
    if (!view || !branches) return
    const merged: VectorTilePathStretch[] = []
    const bandOf: number[] = []
    for (const [band, branch] of branches.entries()) {
      for (const stretch of branch.stretches) {
        merged.push(stretch)
        bandOf.push(band)
      }
    }
    if (merged.length === 0) return
    const buckets: VectorTilePathPiece[][] = branches.map(() => [])
    for (const piece of source.pathPieces({ marginPx: MARGIN_PX, stretches: merged, view })) {
      buckets[bandOf[piece.rank] ?? 0]?.push(piece)
    }
    for (const [band, bucket] of buckets.entries()) {
      const lines = joinPathPieces(bucket, pixelsPerMetre)
      if (lines.length === 0) continue
      branchChains += lines.length
      const opacity = Math.max(0, Math.min(1, branches[band]?.opacity ?? 1))
      const made: BranchGroup[] = []
      for (let phase = 0; phase < BRANCH_PHASES; phase += 1) {
        made.push({
          count: 0,
          lines: [],
          opacity,
          path: createPath ? createPath() : null,
          shift: phase / BRANCH_PHASES,
        })
      }
      for (const [index, line] of lines.entries()) {
        const group = made[index % BRANCH_PHASES] as BranchGroup
        group.count += 1
        const path = group.path as (FlowPulsePath & FlowPulsePathBuilder) | null
        if (path) traceLine(path, line.points)
        else group.lines.push(line.points)
      }
      for (const group of made) if (group.count > 0) groups.push(group)
    }
  }

  function rebuild() {
    stop()
    cancelRetry()
    chains = []
    groups = []
    branchChains = 0
    const hasPath = stretches !== null && stretches.length > 0
    const hasBranches = branches?.some((branch) => branch.stretches.length > 0) ?? false
    if (destroyed || held || !view || (!hasPath && !hasBranches)) {
      mode = 'idle'
      if (view) {
        resize(view)
        clear()
      }
      return
    }
    resize(view)
    clear()
    const pixelsPerMetre = pixelsPerMeter(view)
    if (hasPath) {
      const pieces = source.pathPieces({ marginPx: MARGIN_PX, stretches: stretches!, view })
      chains = joinPathPieces(pieces, pixelsPerMetre)
      keepPaths(chains)
    }
    if (hasBranches) buildBranches(pixelsPerMetre)
    if (chains.length === 0 && groups.length === 0) {
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
    configure()
    context2d.lineCap = 'round'
    context2d.lineJoin = 'round'
    if (reduced() || !requestFrame) {
      mode = 'chevrons'
      groups = []
      paintChevrons()
      return
    }
    mode = 'pulse'
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
      groups = []
      mode = 'idle'
      if (view) clear()
    },
    setPath(next, nextBranches = null) {
      stretches = next && next.length > 0 ? next : null
      branches = nextBranches && nextBranches.length > 0 ? nextBranches : null
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
      return { branchChains, chains: chains.length, frames, mode, points }
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
