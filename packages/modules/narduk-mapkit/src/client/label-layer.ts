/**
 * Label layer: names placed on the map so they never cover a mark.
 *
 * On the national river map a visitor cannot tell the Ohio from the Tennessee
 * without names, and the map already carries tens of thousands of line
 * stretches and gauge dots. This is the small layer that draws the names. It is
 * not a river layer: the caller gives anchors (text, position, a priority, a
 * first zoom, an optional id) and a style, and a function that says where the
 * marks are on screen. Nothing here knows what an anchor names.
 *
 * Placement is greedy and deterministic. Anchors are ranked once, by priority
 * (higher first), then by a stable key (the id, else text and position), and
 * only then by input position for exact duplicates. Each frame walks that
 * ranking and keeps a label only if its box touches no label already kept and
 * no obstacle. A label that does not fit is dropped for this frame: it is not
 * moved, shrunk or abbreviated, so what stays on screen is exactly what was
 * measured. The same anchors, view and size always give the same labels.
 *
 * Cost is bounded without a wall clock: text is measured once per distinct
 * string and style (a bounded cache), obstacles and kept labels sit in one grid
 * so a candidate tests only the few items near it, and the work is reported as
 * counts in {@link LabelPlacementStats}. The tests pin those counts.
 */
import { createMapKitRenderScheduler } from './render.js'
import {
  MAP_WORLD_TILE_PX,
  projectToWorldFraction,
  requirePointLayerView,
  worldFractionDelta,
} from './point-layer.js'

import type { VectorTileCoordinate } from './hit-test.js'
import type { PointLayerScreenCircle, PointLayerView } from './point-layer.js'
import type { MapKitFrameScheduler } from './timers.js'

/** Most labels placed in one frame unless the caller says otherwise. */
export const LABEL_LAYER_DEFAULT_MAX_LABELS = 200

/**
 * How far past the visible edge, in CSS pixels, an anchor is still considered,
 * so a label whose anchor is just off screen can still show its near half.
 */
export const LABEL_LAYER_DEFAULT_MARGIN_PX = 128

/** Distinct (font, text) widths the measure cache keeps; the oldest-used leaves first. */
export const LABEL_LAYER_DEFAULT_MEASURE_CACHE_LIMIT = 1024

/**
 * Work for placing and painting a national view: 3,000 candidate anchors
 * against 5,000 obstacle dots. Counted in operations, not milliseconds, so it
 * cannot flake under load; measured in `tests/label-layer.test.ts`, which also
 * logs the wall time it saw for information.
 */
export const LABEL_LAYER_NATIONAL_FRAME_BUDGET = {
  anchors: 3000,
  /** Anchors examined (ranked scan) in one frame. */
  considered: 3000,
  /** Box-versus-item overlap tests in one frame. */
  overlapTests: 60_000,
  obstacles: 5000,
  /** `strokeText` plus `fillText` calls in one frame. */
  textCalls: 2 * LABEL_LAYER_DEFAULT_MAX_LABELS,
} as const

const GRID_CELL_PX = 64
const GRID_KEY_OFFSET = 4096
const GRID_KEY_SPAN = 8192
const GRID_CLAMP_PX = 1024
const DEFAULT_PADDING_PX = 2
const DEFAULT_LINE_HEIGHT = 1.2

/** One name to place. `priority` higher wins; `minZoom` is the first zoom it may show. */
export interface LabelAnchor {
  /** Returned by {@link LabelLayer.labelAt}; absent means the hit says so, never 0. */
  id?: number | string
  latitude: number
  longitude: number
  minZoom: number
  priority: number
  text: string
}

/** How a label is painted. Every colour and the font come from the caller. */
export interface LabelStyle {
  /** Text colour. */
  fill: string
  fontFamily: string
  /** Font size in CSS pixels, before the device pixel ratio. */
  fontSize: number
  fontWeight?: number | string
  /** Colour of the stroke painted under the fill so text reads on any ground. */
  halo: string
  /** Halo stroke width in CSS pixels. 0 paints no halo. */
  haloWidth: number
  /** Line box height as a multiple of `fontSize`. Default 1.2. */
  lineHeight?: number
  /** Clear space kept around the text box, CSS pixels, beyond the halo. Default 2. */
  padding?: number
}

/** A single style, or one chosen per anchor (return a stable object per class of anchor). */
export type LabelStyleSource = LabelStyle | ((anchor: LabelAnchor) => LabelStyle)

/** A dot-shaped mark in screen space; `x`, `y` is the centre. Same shape the point layer returns. */
export type LabelCircleObstacle = PointLayerScreenCircle

/** A rectangular mark in screen space; `x`, `y` is the top-left corner. */
export interface LabelRectObstacle {
  height: number
  width: number
  x: number
  y: number
}

export type LabelObstacle = LabelCircleObstacle | LabelRectObstacle

/** The screen as it is now, plus the pixel ratio the canvas is backed at (default 1). */
export interface LabelView extends PointLayerView {
  pixelRatio?: number
}

/** The 2D surface the label painter and its measurer need, narrowed to what they call. */
export interface LabelCanvasContext {
  fillStyle: string | object
  font: string
  lineJoin: string
  lineWidth: number
  strokeStyle: string | object
  textAlign: string
  textBaseline: string
  clearRect: (x: number, y: number, width: number, height: number) => void
  fillText: (text: string, x: number, y: number) => void
  measureText: (text: string) => { width: number }
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void
  strokeText: (text: string, x: number, y: number) => void
}

export interface LabelCanvas {
  height: number
  width: number
  getContext: (contextId: '2d') => LabelCanvasContext | null
}

export interface LabelLayerOptions<TCanvas extends LabelCanvas = LabelCanvas> {
  anchors: readonly LabelAnchor[]
  cancelAnimationFrame?: MapKitFrameScheduler['cancelAnimationFrame']
  /** The canvas {@link LabelLayer.requestPaint} paints into. */
  canvas?: TCanvas
  /**
   * Makes the small canvas text is measured on when `measureText` is not given.
   * Give this or `measureText`.
   */
  createCanvas?: (width: number, height: number) => LabelCanvas
  /** Most labels per frame. Default {@link LABEL_LAYER_DEFAULT_MAX_LABELS}. */
  maxLabels?: number
  /** Default {@link LABEL_LAYER_DEFAULT_MARGIN_PX}. */
  marginPx?: number
  /** Distinct (font, text) widths cached. Default {@link LABEL_LAYER_DEFAULT_MEASURE_CACHE_LIMIT}. */
  measureCacheLimit?: number
  /** Width in CSS pixels of `text` set in the CSS `font` shorthand. Default: canvas `measureText`. */
  measureText?: (text: string, font: string) => number
  /**
   * Marks to avoid, in screen space for the view being placed. Called once per
   * placement and read synchronously. A point layer's `obstaclesInView` fits.
   */
  obstacles?: (view: LabelView) => Iterable<LabelObstacle>
  /** Called after each {@link LabelLayer.requestPaint} frame has painted. */
  onPainted?: (placement: LabelPlacement) => void
  requestAnimationFrame?: MapKitFrameScheduler['requestAnimationFrame']
  style: LabelStyleSource
}

/** One label kept for the frame. Positions are CSS pixels from the view's top-left. */
export interface PlacedLabel {
  /** Height of the text box. */
  height: number
  /** Index of the anchor in the array the layer was given. */
  index: number
  id: number | string | undefined
  style: LabelStyle
  text: string
  /** Width of the text box, measured once and cached. */
  width: number
  /** Centre of the text, which is the anchor's position. */
  x: number
  y: number
}

/** What one placement did, in counts. Nothing here is a time. */
export interface LabelPlacementStats {
  /** Stopped at `maxLabels` with anchors left unexamined. */
  capped: boolean
  /** Anchors that passed the zoom and region rules and were tried. */
  considered: number
  droppedByLabel: number
  droppedByObstacle: number
  /** Cache misses: `measureText` calls this frame. */
  measured: number
  /** Anchors skipped because the view is below their first zoom. */
  belowMinZoom: number
  /** Anchors skipped because they sit outside the region plus the margin. */
  outsideRegion: number
  /** Obstacles put in the grid. */
  obstacles: number
  /** Box-versus-item overlap tests. */
  overlapTests: number
  /** Anchors skipped because their text could not be measured to a positive width. */
  unmeasurable: number
}

export interface LabelPlacement {
  labels: PlacedLabel[]
  stats: LabelPlacementStats
}

export interface LabelHit {
  /** Index of the anchor in the array the layer was given. */
  index: number
  /** The anchor's id, or `undefined` when it has none. */
  id: number | string | undefined
  text: string
}

export interface LabelMeasureCacheStats {
  hits: number
  limit: number
  misses: number
  size: number
}

export interface LabelLayer<TCanvas extends LabelCanvas = LabelCanvas> {
  readonly anchorCount: number
  readonly cacheStats: LabelMeasureCacheStats
  /** Cancel a pending frame and stop painting. Idempotent. */
  destroy: () => void
  /** Paint a pending {@link LabelLayer.requestPaint} now instead of next frame. */
  flushNow: () => void
  /**
   * The label under a coordinate, from the last placed frame only. `null` when
   * nothing is within `toleranceInPixels` of a label box, when no frame has
   * been placed, or when `zoom` is not the zoom that frame was placed at: a
   * stale answer would name the wrong place. Synchronous; reads no tiles.
   */
  labelAt: (
    coordinate: VectorTileCoordinate,
    toleranceInPixels: number,
    zoom: number,
  ) => LabelHit | null
  /** Place and paint now into `canvas` (default: the option's canvas). */
  paint: (view: LabelView, canvas?: TCanvas) => LabelPlacement
  /** Choose labels for the view without painting; also becomes the frame `labelAt` answers from. */
  place: (view: LabelView) => LabelPlacement
  /** Coalesce region changes: many calls in a frame paint once, with the latest view. */
  requestPaint: (view: LabelView) => void
  /** Replace the anchors. Positions are projected again here, once. */
  setAnchors: (anchors: readonly LabelAnchor[]) => void
  setStyle: (style: LabelStyleSource) => void
}

interface CompiledAnchors {
  anchors: readonly LabelAnchor[]
  /** Anchor indexes, best first. */
  rank: Uint32Array
  worldX: Float64Array
  worldY: Float64Array
}

export function createLabelLayer<TCanvas extends LabelCanvas = LabelCanvas>(
  options: LabelLayerOptions<TCanvas>,
): LabelLayer<TCanvas> {
  const maxLabels = options.maxLabels ?? LABEL_LAYER_DEFAULT_MAX_LABELS
  if (!Number.isInteger(maxLabels) || maxLabels < 0) {
    throw new RangeError('maxLabels must be an integer >= 0')
  }
  const marginPx = options.marginPx ?? LABEL_LAYER_DEFAULT_MARGIN_PX
  if (!Number.isFinite(marginPx) || marginPx < 0) {
    throw new RangeError('marginPx must be a finite number >= 0')
  }
  const cacheLimit = options.measureCacheLimit ?? LABEL_LAYER_DEFAULT_MEASURE_CACHE_LIMIT
  if (!Number.isInteger(cacheLimit) || cacheLimit < 1) {
    throw new RangeError('measureCacheLimit must be an integer >= 1')
  }
  if (!options.measureText && !options.createCanvas) {
    throw new TypeError('give measureText, or createCanvas to measure on a canvas')
  }

  const measure = createMeasureCache(options, cacheLimit)
  let compiled = compileAnchors(options.anchors)
  let styleSource = requireStyleSource(options.style)
  let lastView: LabelView | null = null
  let lastPlacement: LabelPlacement | null = null
  const scheduled: { view: LabelView | null } = { view: null }

  const scheduler = createMapKitRenderScheduler({
    ...(options.cancelAnimationFrame && { cancelAnimationFrame: options.cancelAnimationFrame }),
    ...(options.requestAnimationFrame && { requestAnimationFrame: options.requestAnimationFrame }),
    onFlush: () => {
      const view = scheduled.view
      scheduled.view = null
      if (!view || !options.canvas) return
      options.onPainted?.(paintInto(options.canvas, view))
    },
  })

  function place(view: LabelView): LabelPlacement {
    const { halfHeight, halfWidth, pixelsPerWorld } = requirePointLayerView(view)
    const center = projectToWorldFraction(view.longitude, view.latitude)
    const stats: LabelPlacementStats = {
      belowMinZoom: 0,
      capped: false,
      considered: 0,
      droppedByLabel: 0,
      droppedByObstacle: 0,
      measured: 0,
      obstacles: 0,
      outsideRegion: 0,
      overlapTests: 0,
      unmeasurable: 0,
    }
    const labels: PlacedLabel[] = []
    const grid = createGrid(view, marginPx)

    if (options.obstacles) {
      for (const obstacle of options.obstacles(view)) {
        if (grid.addObstacle(obstacle)) stats.obstacles += 1
      }
    }

    const { anchors, rank, worldX, worldY } = compiled
    const reachX = halfWidth + marginPx
    const reachY = halfHeight + marginPx
    for (let cursor = 0; cursor < rank.length; cursor += 1) {
      if (labels.length >= maxLabels) {
        stats.capped = true
        break
      }
      const index = rank[cursor] ?? 0
      const anchor = anchors[index]
      if (!anchor) continue
      if (view.zoom < anchor.minZoom) {
        stats.belowMinZoom += 1
        continue
      }
      const dx = -worldFractionDelta(center.x, worldX[index] ?? 0) * pixelsPerWorld
      const dy = ((worldY[index] ?? 0) - center.y) * pixelsPerWorld
      if (Math.abs(dx) > reachX || Math.abs(dy) > reachY) {
        stats.outsideRegion += 1
        continue
      }

      stats.considered += 1
      const style = typeof styleSource === 'function' ? styleSource(anchor) : styleSource
      const font = fontShorthand(style)
      const before = measure.misses
      const width = measure.width(anchor.text, font)
      stats.measured += measure.misses - before
      if (!(width > 0) || !Number.isFinite(width)) {
        stats.unmeasurable += 1
        continue
      }
      const height = style.fontSize * (style.lineHeight ?? DEFAULT_LINE_HEIGHT)
      const grow = (style.padding ?? DEFAULT_PADDING_PX) + style.haloWidth / 2
      const x = halfWidth + dx
      const y = halfHeight + dy
      const blocker = grid.firstBlocker(
        x - width / 2 - grow,
        y - height / 2 - grow,
        x + width / 2 + grow,
        y + height / 2 + grow,
      )
      stats.overlapTests += blocker.tests
      if (blocker.kind === 'label') {
        stats.droppedByLabel += 1
        continue
      }
      if (blocker.kind === 'obstacle') {
        stats.droppedByObstacle += 1
        continue
      }
      grid.addLabel(
        x - width / 2 - grow,
        y - height / 2 - grow,
        x + width / 2 + grow,
        y + height / 2 + grow,
      )
      labels.push({ height, id: anchor.id, index, style, text: anchor.text, width, x, y })
    }

    const placement = { labels, stats }
    lastView = view
    lastPlacement = placement
    return placement
  }

  function paintInto(canvas: TCanvas, view: LabelView): LabelPlacement {
    const ratio = view.pixelRatio ?? 1
    if (!Number.isFinite(ratio) || ratio <= 0) {
      throw new RangeError('pixelRatio must be a finite number > 0')
    }
    const placement = place(view)
    const backingWidth = Math.round(view.width * ratio)
    const backingHeight = Math.round(view.height * ratio)
    // Assigning a size clears the canvas and its state, so only do it on change.
    if (canvas.width !== backingWidth) canvas.width = backingWidth
    if (canvas.height !== backingHeight) canvas.height = backingHeight
    const context = canvas.getContext('2d')
    if (!context) return placement

    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, view.width, view.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    let font = ''
    for (const label of placement.labels) {
      const next = fontShorthand(label.style)
      if (next !== font) {
        context.font = next
        font = next
      }
      // Snap the centre to a device pixel so the glyphs are not smeared across two.
      const x = Math.round(label.x * ratio) / ratio
      const y = Math.round(label.y * ratio) / ratio
      if (label.style.haloWidth > 0) {
        context.lineWidth = label.style.haloWidth
        context.strokeStyle = label.style.halo
        context.strokeText(label.text, x, y)
      }
      context.fillStyle = label.style.fill
      context.fillText(label.text, x, y)
    }
    return placement
  }

  return {
    get anchorCount() {
      return compiled.anchors.length
    },
    get cacheStats() {
      return measure.stats()
    },
    destroy: () => {
      scheduled.view = null
      scheduler.destroy()
    },
    flushNow: () => scheduler.flushNow(),
    labelAt(coordinate, toleranceInPixels, zoom) {
      if (!Number.isFinite(toleranceInPixels) || toleranceInPixels < 0) {
        throw new RangeError('toleranceInPixels must be a finite number >= 0')
      }
      if (!lastView || !lastPlacement || zoom !== lastView.zoom) return null
      const pixelsPerWorld = MAP_WORLD_TILE_PX * 2 ** lastView.zoom
      const center = projectToWorldFraction(lastView.longitude, lastView.latitude)
      const probe = projectToWorldFraction(coordinate.longitude, coordinate.latitude)
      const px = lastView.width / 2 - worldFractionDelta(center.x, probe.x) * pixelsPerWorld
      const py = lastView.height / 2 + (probe.y - center.y) * pixelsPerWorld
      let best: { distance: number; label: PlacedLabel } | null = null
      // Placed order is rank order, so on a tie the higher-priority label wins.
      for (const label of lastPlacement.labels) {
        const dx = Math.max(Math.abs(px - label.x) - label.width / 2, 0)
        const dy = Math.max(Math.abs(py - label.y) - label.height / 2, 0)
        const distance = Math.hypot(dx, dy)
        if (distance > toleranceInPixels) continue
        if (!best || distance < best.distance) best = { distance, label }
      }
      return best ? { id: best.label.id, index: best.label.index, text: best.label.text } : null
    },
    paint(view, canvas) {
      const target = canvas ?? options.canvas
      if (!target) throw new TypeError('paint needs a canvas, here or in the options')
      return paintInto(target, view)
    },
    place,
    requestPaint(view) {
      if (!options.canvas) throw new TypeError('requestPaint needs the canvas option')
      scheduled.view = view
      scheduler.mark('labels')
    },
    setAnchors(next) {
      compiled = compileAnchors(next)
      lastView = null
      lastPlacement = null
    },
    setStyle(next) {
      styleSource = requireStyleSource(next)
    },
  }
}

function fontShorthand(style: LabelStyle): string {
  return `${style.fontWeight ?? 'normal'} ${style.fontSize}px ${style.fontFamily}`
}

function requireStyleSource(style: LabelStyleSource): LabelStyleSource {
  if (typeof style === 'function') return style
  if (!style || typeof style.fill !== 'string' || typeof style.halo !== 'string') {
    throw new TypeError('style needs fill and halo colours from the caller; none is assumed')
  }
  if (!Number.isFinite(style.fontSize) || style.fontSize <= 0) {
    throw new RangeError('style.fontSize must be a finite number > 0')
  }
  if (!Number.isFinite(style.haloWidth) || style.haloWidth < 0) {
    throw new RangeError('style.haloWidth must be a finite number >= 0')
  }
  return style
}

function compileAnchors(anchors: readonly LabelAnchor[]): CompiledAnchors {
  const count = anchors.length
  const worldX = new Float64Array(count)
  const worldY = new Float64Array(count)
  const keys: string[] = []
  for (let index = 0; index < count; index += 1) {
    const anchor = anchors[index]
    if (
      !anchor ||
      typeof anchor.text !== 'string' ||
      ![anchor.longitude, anchor.latitude, anchor.priority, anchor.minZoom].every(Number.isFinite)
    ) {
      throw new RangeError(
        `anchors[${index}] needs text and finite longitude, latitude, priority and minZoom`,
      )
    }
    const world = projectToWorldFraction(anchor.longitude, anchor.latitude)
    worldX[index] = world.x
    worldY[index] = world.y
    keys.push(
      anchor.id === undefined
        ? `t:${anchor.text}@${anchor.longitude},${anchor.latitude}`
        : `i:${anchor.id}`,
    )
  }
  const order = Array.from({ length: count }, (_, index) => index)
  order.sort((left, right) => {
    const priority = (anchors[right]?.priority ?? 0) - (anchors[left]?.priority ?? 0)
    if (priority !== 0) return priority
    const leftKey = keys[left] ?? ''
    const rightKey = keys[right] ?? ''
    // Code-unit order, not locale order: the same on every device.
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1
    return left - right
  })
  return { anchors, rank: Uint32Array.from(order), worldX, worldY }
}

function createMeasureCache(
  options: Pick<LabelLayerOptions, 'createCanvas' | 'measureText'>,
  limit: number,
) {
  const widths = new Map<string, number>()
  let hits = 0
  let misses = 0
  let context: LabelCanvasContext | null = null

  function measureNow(text: string, font: string): number {
    if (options.measureText) return options.measureText(text, font)
    context ??= options.createCanvas?.(1, 1).getContext('2d') ?? null
    if (!context) return Number.NaN
    context.font = font
    return context.measureText(text).width
  }

  return {
    get misses() {
      return misses
    },
    stats(): LabelMeasureCacheStats {
      return { hits, limit, misses, size: widths.size }
    },
    width(text: string, font: string): number {
      const key = `${font}\u0000${text}`
      const cached = widths.get(key)
      if (cached !== undefined) {
        hits += 1
        // Re-insert so the least recently used key is always first in the map.
        widths.delete(key)
        widths.set(key, cached)
        return cached
      }
      misses += 1
      const width = measureNow(text, font)
      widths.set(key, width)
      if (widths.size > limit) {
        const oldest = widths.keys().next().value
        if (oldest !== undefined) widths.delete(oldest)
      }
      return width
    },
  }
}

type Blocker = { kind: 'label' | 'obstacle' | null; tests: number }

/**
 * One grid for obstacles and kept labels, so a candidate box is tested only
 * against items sharing a cell with it. Items are stored in flat arrays.
 */
function createGrid(view: PointLayerView, margin: number) {
  const minCell = Math.floor(-(margin + GRID_CLAMP_PX) / GRID_CELL_PX)
  const maxCellX = Math.ceil((view.width + margin + GRID_CLAMP_PX) / GRID_CELL_PX)
  const maxCellY = Math.ceil((view.height + margin + GRID_CLAMP_PX) / GRID_CELL_PX)
  const cells = new Map<number, number[]>()
  const left: number[] = []
  const top: number[] = []
  const right: number[] = []
  const bottom: number[] = []
  // Radius of a circle, or -1 for a rectangle.
  const radius: number[] = []
  const centerX: number[] = []
  const centerY: number[] = []
  const isLabel: boolean[] = []
  const seen: number[] = []
  let stamp = 0

  function cellRange(min: number, max: number, last: number) {
    return [
      Math.min(last, Math.max(minCell, Math.floor(min / GRID_CELL_PX))),
      Math.min(last, Math.max(minCell, Math.floor(max / GRID_CELL_PX))),
    ] as const
  }

  function insert(box: readonly [number, number, number, number], r: number, label: boolean) {
    const id = left.length
    left.push(box[0])
    top.push(box[1])
    right.push(box[2])
    bottom.push(box[3])
    radius.push(r)
    centerX.push((box[0] + box[2]) / 2)
    centerY.push((box[1] + box[3]) / 2)
    isLabel.push(label)
    seen.push(0)
    const [firstX, lastX] = cellRange(box[0], box[2], maxCellX)
    const [firstY, lastY] = cellRange(box[1], box[3], maxCellY)
    for (let cy = firstY; cy <= lastY; cy += 1) {
      for (let cx = firstX; cx <= lastX; cx += 1) {
        const key = (cx + GRID_KEY_OFFSET) * GRID_KEY_SPAN + (cy + GRID_KEY_OFFSET)
        const bucket = cells.get(key)
        if (bucket) bucket.push(id)
        else cells.set(key, [id])
      }
    }
  }

  function hits(id: number, l: number, t: number, r: number, b: number): boolean {
    const itemRadius = radius[id] ?? -1
    if (itemRadius < 0) {
      return (
        l < (right[id] ?? 0) && r > (left[id] ?? 0) && t < (bottom[id] ?? 0) && b > (top[id] ?? 0)
      )
    }
    const cx = centerX[id] ?? 0
    const cy = centerY[id] ?? 0
    const nearX = Math.min(r, Math.max(l, cx))
    const nearY = Math.min(b, Math.max(t, cy))
    return (nearX - cx) ** 2 + (nearY - cy) ** 2 < itemRadius * itemRadius
  }

  return {
    addLabel(l: number, t: number, r: number, b: number) {
      insert([l, t, r, b], -1, true)
    },
    addObstacle(obstacle: LabelObstacle): boolean {
      if ('radius' in obstacle) {
        const { radius: r, x, y } = obstacle
        if (![x, y, r].every(Number.isFinite) || r <= 0) return false
        insert([x - r, y - r, x + r, y + r], r, false)
        return true
      }
      const { height, width, x, y } = obstacle
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false
      insert([x, y, x + width, y + height], -1, false)
      return true
    },
    firstBlocker(l: number, t: number, r: number, b: number): Blocker {
      stamp += 1
      let tests = 0
      const [firstX, lastX] = cellRange(l, r, maxCellX)
      const [firstY, lastY] = cellRange(t, b, maxCellY)
      for (let cy = firstY; cy <= lastY; cy += 1) {
        for (let cx = firstX; cx <= lastX; cx += 1) {
          const bucket = cells.get((cx + GRID_KEY_OFFSET) * GRID_KEY_SPAN + (cy + GRID_KEY_OFFSET))
          if (!bucket) continue
          for (const id of bucket) {
            if (seen[id] === stamp) continue
            seen[id] = stamp
            tests += 1
            if (hits(id, l, t, r, b)) {
              return { kind: isLabel[id] ? 'label' : 'obstacle', tests }
            }
          }
        }
      }
      return { kind: null, tests }
    },
  }
}
