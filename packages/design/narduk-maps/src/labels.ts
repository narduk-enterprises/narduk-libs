import type { ViewPoint } from './projection'

/** Label placement in viewBox units. Pure functions: no DOM, no clock, SSR-identical. */

function ringArea(ring: ViewPoint[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as ViewPoint
    const b = ring[j] as ViewPoint
    sum += (b[0] + a[0]) * (b[1] - a[1])
  }
  return Math.abs(sum / 2)
}

/** Signed distance from a point to a polygon's outline: positive inside, negative outside. */
function signedDistance(x: number, y: number, rings: ViewPoint[][]): number {
  let inside = false
  let minSq = Infinity
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i] as ViewPoint
      const b = ring[j] as ViewPoint
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
        inside = !inside
      }
      let px = a[0]
      let py = a[1]
      let dx = b[0] - px
      let dy = b[1] - py
      if (dx !== 0 || dy !== 0) {
        const t = ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy)
        if (t > 1) {
          px = b[0]
          py = b[1]
        } else if (t > 0) {
          px += dx * t
          py += dy * t
        }
      }
      dx = x - px
      dy = y - py
      minSq = Math.min(minSq, dx * dx + dy * dy)
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minSq)
}

/**
 * An approximation of the pole of inaccessibility: the point inside the polygon farthest from
 * its edge. A coarse grid, then a few refinement passes that re-grid around the best cell.
 */
export function poleOfInaccessibility(rings: ViewPoint[][]): ViewPoint {
  const outer = rings[0] as ViewPoint[]
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of outer) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  let best: ViewPoint = [(x0 + x1) / 2, (y0 + y1) / 2]
  let bestDistance = signedDistance(best[0], best[1], rings)
  let halfX = (x1 - x0) / 2
  let halfY = (y1 - y0) / 2
  let cx = best[0]
  let cy = best[1]
  const steps = 12
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const x = cx - halfX + (2 * halfX * i) / steps
        const y = cy - halfY + (2 * halfY * j) / steps
        const distance = signedDistance(x, y, rings)
        if (distance > bestDistance) {
          bestDistance = distance
          best = [x, y]
        }
      }
    }
    cx = best[0]
    cy = best[1]
    halfX = (halfX * 2) / steps
    halfY = (halfY * 2) / steps
  }
  return [Math.round(best[0] * 100) / 100, Math.round(best[1] * 100) / 100]
}

/** The visual centre of the largest ring (by area) of a projected multipolygon. */
export function labelAnchor(polygons: ViewPoint[][][]): ViewPoint | null {
  let largest: ViewPoint[][] | null = null
  let area = -1
  for (const rings of polygons) {
    const a = ringArea(rings[0] as ViewPoint[])
    if (a > area) {
      area = a
      largest = rings
    }
  }
  return largest ? poleOfInaccessibility(largest) : null
}

export interface LabelInput {
  id: string
  /** First line, drawn at the anchor's y. */
  text: string
  /** Optional lines drawn below it (print mode's level text). */
  sub?: string[]
  x: number
  y: number
  /** Basemap names (`place`, `water`) styled by kind. */
  kind?: 'place' | 'water'
  /** Type size and glyph advance when they differ from the frame's (baked names are smaller). */
  fontSize?: number
  charWidth?: number
  /**
   * Dropped rather than moved far or clipped: skipped when its box leaves the frame, and
   * skipped when no nudge clears every mark and every label already placed.
   */
  optional?: boolean
}

export interface PlacedLabel extends LabelInput {
  /** Text box, for tests and debugging. */
  box: Box
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Obstacle {
  x: number
  y: number
  /** Radius including the surface ring and a margin. */
  r: number
}

export interface PlaceOptions {
  width: number
  height: number
  fontSize: number
  /** Glyph advance as a share of the font size, letter-spacing included. */
  charWidth: number
  /** Gap kept between a label and a mark. */
  gap?: number
  /** Gap kept from the frame edge. */
  edge?: number
  step?: number
  maxShift?: number
}

export function labelBox(label: LabelInput, o: PlaceOptions, x = label.x, y = label.y): Box {
  const lines = [label.text, ...(label.sub ?? [])]
  const longest = Math.max(...lines.map(l => l.length))
  const size = label.fontSize ?? o.fontSize
  const w = longest * size * (label.charWidth ?? o.charWidth)
  const lineHeight = size * 1.25
  return {
    x0: x - w / 2,
    x1: x + w / 2,
    y0: y - size * 0.85,
    y1: y + (lines.length - 1) * lineHeight + size * 0.25,
  }
}

function boxHitsCircle(b: Box, c: Obstacle): boolean {
  const nx = Math.max(b.x0, Math.min(c.x, b.x1))
  const ny = Math.max(b.y0, Math.min(c.y, b.y1))
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
}

/** Does a label box overlap any obstacle circle? Exported for the tests. */
export function labelHitsObstacle(box: Box, obstacles: Obstacle[]): boolean {
  return obstacles.some(c => boxHitsCircle(box, c))
}

/**
 * Place each label at its anchor, clamped inside the frame, then greedily nudge it up, down,
 * left or right (growing steps) until it clears every mark and every label already placed.
 * If no axis nudge works, scan a grid around the anchor; if even that fails the label stays at
 * its clamped anchor.
 */
export function placeLabels(
  items: LabelInput[],
  obstacles: Obstacle[],
  options: PlaceOptions,
): PlacedLabel[] {
  const gap = options.gap ?? 2
  const edge = options.edge ?? 3
  const step = options.step ?? 2
  const maxShift = options.maxShift ?? Math.max(options.width, options.height) / 4
  const grown = obstacles.map(o => ({ ...o, r: o.r + gap }))
  const placed: PlacedLabel[] = []

  const clamp = (item: LabelInput, x: number, y: number): [number, number] => {
    const base = labelBox(item, options, 0, 0)
    const halfW = (base.x1 - base.x0) / 2
    return [
      Math.min(Math.max(x, halfW + edge), Math.max(halfW + edge, options.width - halfW - edge)),
      Math.min(
        Math.max(y, -base.y0 + edge),
        Math.max(-base.y0 + edge, options.height - base.y1 - edge),
      ),
    ]
  }

  for (const item of items) {
    if (item.optional) {
      const b = labelBox(item, options)
      if (b.x0 < 0 || b.y0 < 0 || b.x1 > options.width || b.y1 > options.height) continue
    }
    const [ax, ay] = clamp(item, item.x, item.y)
    const clear = (x: number, y: number, withLabels: boolean) => {
      const [cx, cy] = clamp(item, x, y)
      if (cx !== x || cy !== y) return null
      const box = labelBox(item, options, x, y)
      if (labelHitsObstacle(box, grown)) return null
      if (withLabels && placed.some(p => boxesOverlap(box, p.box))) return null
      return box
    }
    const search = (withLabels: boolean): PlacedLabel | null => {
      const first = clear(ax, ay, withLabels)
      if (first) return { ...item, x: ax, y: ay, box: first }
      const reach = item.optional ? Math.min(maxShift, options.fontSize * 2.5) : maxShift
      for (let shift = step; shift <= reach; shift += step) {
        for (const [dx, dy] of [
          [0, -shift],
          [0, shift],
          [-shift, 0],
          [shift, 0],
        ] as const) {
          const box = clear(ax + dx, ay + dy, withLabels)
          if (box) return { ...item, x: ax + dx, y: ay + dy, box }
        }
      }
      // Axis nudges failed: scan the neighbourhood in rings of growing radius.
      for (let shift = step; shift <= reach * 1.5; shift += step) {
        for (let k = 0; k < 16; k++) {
          const angle = (k / 16) * Math.PI * 2
          const x = Math.round((ax + Math.cos(angle) * shift) * 100) / 100
          const y = Math.round((ay + Math.sin(angle) * shift) * 100) / 100
          const box = clear(x, y, withLabels)
          if (box) return { ...item, x, y, box }
        }
      }
      return null
    }
    const result = item.optional
      ? search(true)
      : (search(true) ??
        search(false) ?? { ...item, x: ax, y: ay, box: labelBox(item, options, ax, ay) })
    if (result) placed.push(result)
  }
  return placed
}
