import { mapKitZoomForSpan } from '../client/index.js'

import type { MkMapRect } from './runtime.js'

/**
 * Camera math for the map kit, in MapKit's normalized Web Mercator map units
 * (x and y run 0 to 1 from the top left of the world).
 */

export type MapTier = 'close' | 'local' | 'overview' | 'regional'

export interface FramePoint {
  x: number
  y: number
}

export interface FrameSize {
  height: number
  width: number
}

/** Pixels the chrome covers along each edge of the map frame. */
export interface FrameInsets {
  bottom: number
  left: number
  right: number
  top: number
}

export interface LngLatBox {
  east: number
  north: number
  south: number
  west: number
}

export interface LatLon {
  lat: number
  lon: number
}

const TIER_FLOORS: ReadonlyArray<readonly [MapTier, number]> = [
  ['close', 9.3],
  ['local', 7.4],
  ['regional', 5.5],
]
const MAX_MERCATOR_LATITUDE = 85.051_128_78
const TILE_SIZE = 256

export function tierForSpan(longitudeDelta: number, widthPx: number): MapTier {
  const zoom = mapKitZoomForSpan({ longitudeDelta, widthPx })
  if (zoom === null) return 'overview'
  return TIER_FLOORS.find(([, floor]) => zoom >= floor)?.[0] ?? 'overview'
}

function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

function toWorld(lat: number, lon: number): FramePoint {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, lat))
  const sin = Math.sin((clamped * Math.PI) / 180)
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) }
}

function fromWorld(point: FramePoint): LatLon {
  const lat = (Math.atan(Math.sinh(Math.PI - 2 * Math.PI * point.y)) * 180) / Math.PI
  return { lat, lon: wrapLongitude(point.x * 360 - 180) }
}

/** Projects a coordinate to frame pixels, using the world copy nearest the view centre. */
export function projectToFrame(rect: MkMapRect, frame: FrameSize, point: LatLon): FramePoint {
  const world = toWorld(point.lat, point.lon)
  const centerX = rect.origin.x + rect.size.width / 2
  const x = world.x + Math.round(centerX - world.x)
  return {
    x: ((x - rect.origin.x) / rect.size.width) * frame.width,
    y: ((world.y - rect.origin.y) / rect.size.height) * frame.height,
  }
}

export function frameToCoordinate(rect: MkMapRect, frame: FrameSize, point: FramePoint): LatLon {
  return fromWorld({
    x: rect.origin.x + (point.x / frame.width) * rect.size.width,
    y: rect.origin.y + (point.y / frame.height) * rect.size.height,
  })
}

/**
 * MapKit reports and takes its visible rect for the PADDED box -- the element
 * less `map.padding` -- not the whole element (measured on live MapKit JS 6: a
 * 200 px bottom padding shrinks `visibleMapRect` to the top 464 of 664 px).
 * The kit's camera math works in whole-frame pixels, so the view converts at
 * the one boundary: `unpadRect` turns MapKit's rect into the whole frame's,
 * and `padRect` turns a whole-frame rect back into the one MapKit expects.
 */
export function unpadRect(rect: MkMapRect, frame: FrameSize, padding: FrameInsets): MkMapRect {
  const innerWidth = frame.width - padding.left - padding.right
  const innerHeight = frame.height - padding.top - padding.bottom
  if (innerWidth <= 0 || innerHeight <= 0) return rect
  const perX = rect.size.width / innerWidth
  const perY = rect.size.height / innerHeight
  return {
    origin: { x: rect.origin.x - padding.left * perX, y: rect.origin.y - padding.top * perY },
    size: { height: perY * frame.height, width: perX * frame.width },
  }
}

/** The inverse of `unpadRect`: the padded box's share of a whole-frame rect. */
export function padRect(rect: MkMapRect, frame: FrameSize, padding: FrameInsets): MkMapRect {
  const innerWidth = frame.width - padding.left - padding.right
  const innerHeight = frame.height - padding.top - padding.bottom
  if (innerWidth <= 0 || innerHeight <= 0) return rect
  const perX = rect.size.width / frame.width
  const perY = rect.size.height / frame.height
  return {
    origin: { x: rect.origin.x + padding.left * perX, y: rect.origin.y + padding.top * perY },
    size: {
      height: rect.size.height - (padding.top + padding.bottom) * perY,
      width: rect.size.width - (padding.left + padding.right) * perX,
    },
  }
}

export function frameContains(frame: FrameSize, point: FramePoint, margin = 0): boolean {
  return (
    point.x >= -margin &&
    point.y >= -margin &&
    point.x <= frame.width + margin &&
    point.y <= frame.height + margin
  )
}

/** The narrowest band the camera will aim at, however much chrome is open. */
const MIN_FREE = 96

/**
 * One axis of the free area. Chrome can ask for more than the frame has -- the
 * phone sheet at its tallest detent covers the map outright -- so the opposing
 * insets are scaled back together until `MIN_FREE` pixels are left. Without
 * that the band collapses to a line and `rectForBox` divides the box it is
 * framing by it, which throws the camera out to the whole world.
 */
function freeSpan(extent: number, near: number, far: number) {
  const total = near + far
  const room = Math.max(0, extent - MIN_FREE)
  const shrink = total > room && total > 0 ? room / total : 1
  return { size: Math.max(MIN_FREE, extent - total * shrink), start: near * shrink }
}

function freeBox(frame: FrameSize, insets: FrameInsets) {
  const across = freeSpan(frame.width, insets.left, insets.right)
  const down = freeSpan(frame.height, insets.top, insets.bottom)
  return {
    height: down.size,
    width: across.size,
    x: across.start + across.size / 2,
    y: down.start + down.size / 2,
  }
}

function rectAround(center: FramePoint, anchor: FramePoint, frame: FrameSize, scale: number) {
  return {
    origin: { x: center.x - anchor.x * scale, y: center.y - anchor.y * scale },
    size: { height: frame.height * scale, width: frame.width * scale },
  }
}

/**
 * The visible map rect that fits a lat/lon box inside the part of the frame the
 * chrome leaves free, centred there. `maxZoom` stops single points zooming in forever.
 */
export function rectForBox(
  box: LngLatBox,
  frame: FrameSize,
  insets: FrameInsets,
  options: { margin?: number; maxZoom?: number } = {},
): MkMapRect {
  const margin = options.margin ?? 32
  const northWest = toWorld(box.north, box.west)
  const southEast = toWorld(box.south, box.east)
  const width =
    southEast.x >= northWest.x ? southEast.x - northWest.x : southEast.x + 1 - northWest.x
  const height = southEast.y - northWest.y
  const free = freeBox(frame, insets)
  const minScale = 1 / (TILE_SIZE * 2 ** (options.maxZoom ?? 11))
  const scale = Math.max(
    minScale,
    width / Math.max(1, free.width - 2 * margin),
    height / Math.max(1, free.height - 2 * margin),
  )
  const center = { x: northWest.x + width / 2, y: northWest.y + height / 2 }
  return rectAround(center, free, frame, scale)
}

/**
 * The visible map rect that moves a frame point to the centre of the free area,
 * keeping the zoom. Returns null when the point is already comfortably inside it.
 */
export function rectRevealing(
  rect: MkMapRect,
  frame: FrameSize,
  insets: FrameInsets,
  point: FramePoint,
  margin = 48,
): MkMapRect | null {
  const free = freeBox(frame, insets)
  const inside =
    Math.abs(point.x - free.x) <= Math.max(0, free.width / 2 - margin) &&
    Math.abs(point.y - free.y) <= Math.max(0, free.height / 2 - margin)
  if (inside) return null
  const scale = rect.size.width / frame.width
  const center = { x: rect.origin.x + point.x * scale, y: rect.origin.y + point.y * scale }
  return rectAround(center, free, frame, scale)
}

/** Zooms the rect around its centre; a factor above 1 zooms in. */
export function zoomRect(rect: MkMapRect, factor: number): MkMapRect {
  const width = rect.size.width / factor
  const height = rect.size.height / factor
  return {
    origin: {
      x: rect.origin.x + (rect.size.width - width) / 2,
      y: rect.origin.y + (rect.size.height - height) / 2,
    },
    size: { height, width },
  }
}
