/**
 * The maths behind a marker that moves: where it is part-way between two fixes,
 * which way it points, and when it must not glide at all.
 *
 * Extracted from the Wave Transit concept's live bus layer, where it drove
 * vehicles gliding between 15-second GPS fixes. Pure -- no map, no DOM, no
 * clock -- so every rule is a table-driven test and the same code runs on the
 * server (to precompute a path) and in the browser.
 *
 * ## The rules, and why
 *
 * - **Linear, not eased.** A vehicle cruises; easing in and out of every fix
 *   makes it look like it brakes at each GPS update.
 * - **Along the line, when there is one.** A glide that cuts the corner across a
 *   block looks wrong. `pathAlongPolylines` follows the route's own line, but
 *   only when both fixes are on it and the way along is not a detour -- it never
 *   invents a path, and answers `null` (glide straight) instead.
 * - **Snap, do not sweep.** A first fix, a jump too long to be one poll's
 *   travel, a tab that was hidden (timers were throttled; the marker is a whole
 *   interval behind) and `prefers-reduced-motion` all draw the new place at once.
 * - **Headings take the short way round.** `unwrapHeading` returns an angle that
 *   may pass 360 or go below 0, so a CSS `rotate` transition from the last
 *   heading turns 20 degrees, not 340.
 */
import { haversineDistanceMetres } from './helpers.js'

import type { LatLng } from './helpers.js'

/** How long a glide takes by default: most of a 15 s poll, so the marker is still moving when the next fix arrives. */
export const MAPKIT_GLIDE_MS = 13_000

/** A jump longer than this is a new place, not a move. */
export const MAPKIT_MAX_GLIDE_METRES = 1500

/** A move shorter than this is GPS noise, not a direction. */
export const MAPKIT_MIN_HEADING_MOVE_METRES = 15

/** Compass bearing in degrees (0 = north, clockwise) of the move from `from` to `to`. */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180
  const dLng = (to.lng - from.lng) * rad
  const y = Math.sin(dLng) * Math.cos(to.lat * rad)
  const x =
    Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
    Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLng)
  return (Math.atan2(y, x) / rad + 360) % 360
}

/** The signed turn from `from` to `to` in degrees, the short way round: always in [-180, 180). */
export function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

/**
 * The heading to draw next. It is "unwrapped" (it can pass 360 or go below 0)
 * so a CSS transition from the last heading turns the short way, never the long
 * way round. With no current heading the target is used as is.
 */
export function unwrapHeading(current: number | undefined, target: number): number {
  return current === undefined ? target : current + shortestAngleDelta(current, target)
}

/** Fold an unwrapped heading back to [0, 360) for display or a `data-` attribute. */
export function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360
}

/** The point `t` (0 to 1, clamped) of the way from `from` to `to`, linearly in latitude and longitude. */
export function interpolateLatLng(from: LatLng, to: LatLng, t: number): LatLng {
  const k = Math.min(1, Math.max(0, t))
  return { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k }
}

/** Why a move is drawn at once instead of glided. */
export type MapKitSnapReason = 'first' | 'hidden' | 'jump' | 'reduced-motion'

export interface MapKitSnapContext {
  /** The first fix this marker has had. */
  first?: boolean
  /** The tab was hidden since the last fix: nothing should sweep on return. */
  hidden?: boolean
  /** A jump longer than this is a new place. Default `MAPKIT_MAX_GLIDE_METRES`. */
  maxGlideMetres?: number
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion?: boolean
}

/**
 * The reason a move must be drawn at once, or `null` when it may glide. The
 * checks run in the order of the `MapKitSnapReason` union's meaning: a first fix
 * has no earlier place to glide from at all, so it wins over everything.
 */
export function mapKitSnapReason(
  from: LatLng,
  to: LatLng,
  context: MapKitSnapContext = {},
): MapKitSnapReason | null {
  if (context.first) return 'first'
  if (context.hidden) return 'hidden'
  if (context.reducedMotion) return 'reduced-motion'
  const limit = context.maxGlideMetres ?? MAPKIT_MAX_GLIDE_METRES
  return haversineDistanceMetres(from, to) > limit ? 'jump' : null
}

/** A polyline with its cumulative length, ready for `pointAlongPath`. */
export interface MapKitGlidePath {
  /** Cumulative metres from the first point; same length as `points`. */
  cumulative: number[]
  points: LatLng[]
}

/** Measure a polyline. */
export function buildGlidePath(points: readonly LatLng[]): MapKitGlidePath {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    cumulative.push(
      (cumulative[i - 1] ?? 0) +
        haversineDistanceMetres(points[i - 1] as LatLng, points[i] as LatLng),
    )
  }
  return { cumulative, points: [...points] }
}

export interface MapKitPathAlongOptions {
  /** The along-line way may be at most this many times the straight way (plus the slack). Default 1.6. */
  detourFactor?: number
  /** Added to the detour limit so two close fixes are not refused for a few metres. Default 60. */
  detourSlackMetres?: number
  /** A fix further than this from a line is not on it. Default 50. */
  onLineMetres?: number
}

interface Projection {
  /** Metres along the line to the projected point. */
  at: number
  /** Metres from the fix to the line. */
  off: number
  point: LatLng
  /** Index of the segment's first vertex. */
  segment: number
}

function projectOntoLine(line: readonly LatLng[], p: LatLng): Projection | null {
  if (line.length < 2) return null
  const kx = Math.cos((p.lat * Math.PI) / 180)
  let best: Projection | null = null
  let run = 0
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i] as LatLng
    const b = line[i + 1] as LatLng
    const segmentLength = haversineDistanceMetres(a, b)
    const dx = (b.lng - a.lng) * kx
    const dy = b.lat - a.lat
    const len2 = dx * dx + dy * dy
    const u =
      len2 === 0
        ? 0
        : Math.min(1, Math.max(0, ((p.lng - a.lng) * kx * dx + (p.lat - a.lat) * dy) / len2))
    const point = { lat: a.lat + dy * u, lng: a.lng + (b.lng - a.lng) * u }
    const off = haversineDistanceMetres(p, point)
    if (!best || off < best.off) best = { at: run + segmentLength * u, off, point, segment: i }
    run += segmentLength
  }
  return best
}

/**
 * The stretch of a route line a vehicle drove between two fixes, so it glides
 * round the corners of its route and not straight across them.
 *
 * `null` (glide straight) when either fix is off every line, or when the way
 * along the line is a detour from the straight way: nothing is invented. With
 * several candidate lines the one both fixes sit closest to wins.
 */
export function pathAlongPolylines(
  lines: ReadonlyArray<readonly LatLng[]>,
  from: LatLng,
  to: LatLng,
  options: MapKitPathAlongOptions = {},
): MapKitGlidePath | null {
  const onLine = options.onLineMetres ?? 50
  const factor = options.detourFactor ?? 1.6
  const slack = options.detourSlackMetres ?? 60
  const straight = haversineDistanceMetres(from, to)
  let best: { cost: number; path: MapKitGlidePath } | null = null
  for (const line of lines) {
    const a = projectOntoLine(line, from)
    const b = projectOntoLine(line, to)
    if (!a || !b || a.off > onLine || b.off > onLine) continue
    const reverse = b.at < a.at
    const [lo, hi] = reverse ? [b, a] : [a, b]
    const stretch = [lo.point, ...line.slice(lo.segment + 1, hi.segment + 1), hi.point]
    const path = buildGlidePath(reverse ? stretch.reverse() : stretch)
    const length = path.cumulative.at(-1) ?? 0
    if (length > straight * factor + slack) continue
    const cost = a.off + b.off
    if (!best || cost < best.cost) best = { cost, path }
  }
  return best?.path ?? null
}

/** The point `t` (0 to 1, clamped) of the way along the path by distance. */
export function pointAlongPath(path: MapKitGlidePath, t: number): LatLng {
  const first = path.points[0]
  if (!first) throw new RangeError('pointAlongPath: the path has no points')
  const total = path.cumulative.at(-1) ?? 0
  if (total === 0) return first
  const target = total * Math.min(1, Math.max(0, t))
  let i = 1
  while (i < path.cumulative.length - 1 && (path.cumulative[i] ?? 0) < target) i++
  const before = path.cumulative[i - 1] ?? 0
  const span = (path.cumulative[i] ?? 0) - before
  return interpolateLatLng(
    path.points[i - 1] as LatLng,
    path.points[i] as LatLng,
    span === 0 ? 0 : (target - before) / span,
  )
}

/**
 * The heading of the last stretch of a path, in degrees, or `null` for a path
 * with no length. This is the direction the route itself runs where the vehicle
 * ends up -- steadier than the bearing between two noisy GPS fixes, and right
 * at a corner the fixes straddle.
 */
export function pathEndHeading(path: MapKitGlidePath): number | null {
  for (let i = path.points.length - 1; i > 0; i--) {
    const from = path.points[i - 1] as LatLng
    const to = path.points[i] as LatLng
    if (haversineDistanceMetres(from, to) >= 1) return bearingDegrees(from, to)
  }
  return null
}
