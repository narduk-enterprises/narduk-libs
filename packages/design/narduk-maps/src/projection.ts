import type {
  Bounds,
  LonLat,
  MapPoint,
  MapView,
  Padding,
  PolygonCoordinates,
  ShapeCollection,
  ShapeGeometry,
} from './types'

/**
 * Web Mercator in unit-world coordinates (0..1), and the camera maths of the GL engine's
 * `fitBounds`, so an SVG viewBox lines up pixel for pixel with the GL map for the same bounds
 * and size. The GL engine uses 512px tiles: its world is 512 * 2^zoom pixels wide.
 */

export const TILE_SIZE = 512
export const MAX_LATITUDE = 85.0511287798
export const MAX_ZOOM = 22

const RAD = Math.PI / 180

const clampLat = (lat: number) => Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat))

export function mercatorX(lon: number): number {
  return (lon + 180) / 360
}

export function mercatorY(lat: number): number {
  const s = Math.sin(clampLat(lat) * RAD)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}

export function unmercatorX(x: number): number {
  return x * 360 - 180
}

export function unmercatorY(y: number): number {
  const y2 = ((180 - y * 360) * Math.PI) / 180
  return (360 / Math.PI) * Math.atan(Math.exp(y2)) - 90
}

/** Counts rings run through the projector; the cache tests read it. */
export const projectionStats = { rings: 0 }

export function normalizePadding(padding: number | Partial<Padding> | undefined): Padding {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding }
  }
  return { top: 0, right: 0, bottom: 0, left: 0, ...padding }
}

export interface FitResult {
  center: LonLat
  zoom: number
}

/**
 * The camera that frames `bounds` in a `width` x `height` pixel box with `padding`: the same
 * maths as the GL engine's `fitBounds` at bearing 0 (zoom = log2 of the pixel scale over the
 * 512px world, capped at `maxZoom`; the centre is the bounds' mercator midpoint shifted by half
 * the padding difference).
 */
export function fitBounds(
  bounds: Bounds,
  size: { width: number; height: number },
  padding: number | Partial<Padding> = 0,
  maxZoom = MAX_ZOOM,
): FitResult {
  const pad = normalizePadding(padding)
  const x0 = mercatorX(bounds[0])
  const x1 = mercatorX(bounds[2])
  const yTop = mercatorY(bounds[3])
  const yBottom = mercatorY(bounds[1])
  const spanX = x1 - x0
  const spanY = yBottom - yTop
  const availableWidth = size.width - pad.left - pad.right
  const availableHeight = size.height - pad.top - pad.bottom
  const scale = Math.min(
    availableWidth / (spanX * TILE_SIZE),
    availableHeight / (spanY * TILE_SIZE),
  )
  const zoom = Math.min(Math.log2(scale), maxZoom)
  const worldSize = TILE_SIZE * 2 ** zoom
  const centerX = (x0 + x1) / 2 - (pad.left - pad.right) / 2 / worldSize
  const centerY = (yTop + yBottom) / 2 - (pad.top - pad.bottom) / 2 / worldSize
  return { center: [unmercatorX(centerX), unmercatorY(centerY)], zoom }
}

const MIN_SPAN = 0.004

function widen(bounds: Bounds): Bounds {
  let [w, s, e, n] = bounds
  if (e - w < MIN_SPAN) {
    w -= MIN_SPAN
    e += MIN_SPAN
  }
  if (n - s < MIN_SPAN) {
    s -= MIN_SPAN
    n += MIN_SPAN
  }
  return [w, s, e, n]
}

const round2 = (v: number) => Math.round(v * 100) / 100

export interface ViewOptions {
  bounds: Bounds
  width: number
  height?: number | undefined
  padding?: number | Partial<Padding> | undefined
}

const viewCache = new Map<string, MapView>()

/**
 * An immutable mapping from lon/lat to viewBox units. The same options always return the same
 * object, which is what lets the path cache below key on it.
 */
export function createMapView(options: ViewOptions): MapView {
  const bounds = widen(options.bounds)
  const padding = normalizePadding(options.padding)
  const key = JSON.stringify([bounds, options.width, options.height ?? null, padding])
  const hit = viewCache.get(key)
  if (hit) return hit

  const width = options.width
  const x0 = mercatorX(bounds[0])
  const x1 = mercatorX(bounds[2])
  const yTop = mercatorY(bounds[3])
  const yBottom = mercatorY(bounds[1])
  const spanX = x1 - x0
  const spanY = yBottom - yTop
  const fitByWidth = (width - padding.left - padding.right) / spanX
  const height = round2(options.height ?? padding.top + padding.bottom + spanY * fitByWidth)
  const scale = Math.min(fitByWidth, (height - padding.top - padding.bottom) / spanY)
  const centerX = (x0 + x1) / 2 - (padding.left - padding.right) / 2 / scale
  const centerY = (yTop + yBottom) / 2 - (padding.top - padding.bottom) / 2 / scale
  const fit = fitBounds(bounds, { width, height }, padding)

  const view: MapView = {
    width,
    height,
    padding,
    bounds,
    scale,
    center: fit.center,
    zoom: fit.zoom,
    project(lon, lat) {
      return [
        round2((mercatorX(lon) - centerX) * scale + width / 2),
        round2((mercatorY(lat) - centerY) * scale + height / 2),
      ]
    },
    unproject(x, y) {
      return [
        unmercatorX((x - width / 2) / scale + centerX),
        unmercatorY((y - height / 2) / scale + centerY),
      ]
    },
  }
  if (viewCache.size > 32) viewCache.clear()
  viewCache.set(key, view)
  return view
}

export interface FrameOptions {
  /** West, south, east, north of the frame, already widened to the frame's aspect. */
  bbox: Bounds
  width: number
  height: number
}

/**
 * The view of a baked cutout: the bbox's north-west corner is the viewBox origin and one
 * scale (viewBox width over the bbox's mercator width) maps both axes, exactly how the
 * baking step projected its paths. No padding, no refit.
 */
export function createFrameView(options: FrameOptions): MapView {
  const { bbox, width, height } = options
  const key = JSON.stringify(['frame', bbox, width, height])
  const hit = viewCache.get(key)
  if (hit) return hit

  const x0 = mercatorX(bbox[0])
  const yTop = mercatorY(bbox[3])
  const scale = width / (mercatorX(bbox[2]) - x0)
  const centerX = x0 + width / 2 / scale
  const centerY = yTop + height / 2 / scale

  const view: MapView = {
    width,
    height,
    padding: normalizePadding(0),
    bounds: bbox,
    scale,
    center: [unmercatorX(centerX), unmercatorY(centerY)],
    zoom: Math.log2(scale / TILE_SIZE),
    project(lon, lat) {
      return [round2((mercatorX(lon) - x0) * scale), round2((mercatorY(lat) - yTop) * scale)]
    },
    unproject(x, y) {
      return [unmercatorX(x0 + x / scale), unmercatorY(yTop + y / scale)]
    },
  }
  if (viewCache.size > 32) viewCache.clear()
  viewCache.set(key, view)
  return view
}

/** The bounds of a geometry, cached per geometry object. */
const boundsCache = new WeakMap<object, Bounds>()

export function geometryBounds(geometry: ShapeGeometry): Bounds {
  const hit = boundsCache.get(geometry)
  if (hit) return hit
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon) {
      for (const position of ring) {
        const lon = position[0] as number
        const lat = position[1] as number
        if (lon < w) w = lon
        if (lon > e) e = lon
        if (lat < s) s = lat
        if (lat > n) n = lat
      }
    }
  }
  const result: Bounds = [w, s, e, n]
  boundsCache.set(geometry, result)
  return result
}

export function mergeBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null
  return list.reduce<Bounds>(
    (a, b) => [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

export function polygonsOf(geometry: ShapeGeometry): PolygonCoordinates[] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
}

export type ViewPoint = [x: number, y: number]

export interface ProjectedGeometry {
  /** SVG path data, every ring closed. */
  d: string
  /** Projected rings by polygon, in viewBox units. */
  polygons: ViewPoint[][][]
}

/**
 * Projected geometry per (view, geometry object). Changing only fills never reaches the
 * projector: the same view and the same geometry object return the stored result.
 */
const projectedCache = new WeakMap<MapView, WeakMap<object, ProjectedGeometry>>()

export function projectGeometry(geometry: ShapeGeometry, view: MapView): ProjectedGeometry {
  let byGeometry = projectedCache.get(view)
  if (!byGeometry) {
    byGeometry = new WeakMap()
    projectedCache.set(view, byGeometry)
  }
  const hit = byGeometry.get(geometry)
  if (hit) return hit

  const polygons: ViewPoint[][][] = []
  let d = ''
  for (const polygon of polygonsOf(geometry)) {
    const rings: ViewPoint[][] = []
    for (const ring of polygon) {
      projectionStats.rings += 1
      const projected: ViewPoint[] = []
      for (const position of ring) {
        const p = view.project(position[0] as number, position[1] as number)
        const last = projected.at(-1)
        if (!last || last[0] !== p[0] || last[1] !== p[1]) projected.push(p)
      }
      if (projected.length > 1) {
        const first = projected[0] as ViewPoint
        const last = projected.at(-1) as ViewPoint
        if (first[0] === last[0] && first[1] === last[1]) projected.pop()
      }
      if (projected.length < 3) continue
      rings.push(projected)
      d += `M${projected.map(p => `${p[0]},${p[1]}`).join('L')}Z`
    }
    if (rings.length > 0) polygons.push(rings)
  }
  const result: ProjectedGeometry = { d, polygons }
  byGeometry.set(geometry, result)
  return result
}

/** The bounds both engines frame: `bounds` if given, else every shape and every point. */
export function resolveBounds(
  shapes: ShapeCollection | null | undefined,
  points: MapPoint[] | undefined,
  bounds: Bounds | null | undefined,
): Bounds {
  if (bounds) return bounds
  const list: Bounds[] = (shapes?.features ?? []).map(f => geometryBounds(f.geometry))
  for (const p of points ?? []) list.push([p.lon, p.lat, p.lon, p.lat])
  return mergeBounds(list) ?? [-1, -1, 1, 1]
}
