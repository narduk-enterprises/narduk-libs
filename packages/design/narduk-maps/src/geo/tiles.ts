// Web Mercator tile maths and the two places tiles come from: a PMTiles archive per frame (catalog
// v2) or an XYZ URL template (the v1 water-colour pyramids).

import { PMTiles } from 'pmtiles'

export const MAX_LAT = 85.0511287798

export function mercX(lon: number): number {
  return (lon + 180) / 360
}

export function mercY(lat: number): number {
  const c = Math.min(Math.max(lat, -MAX_LAT), MAX_LAT)
  const s = Math.sin((c * Math.PI) / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}

export interface TileId {
  x: number
  y: number
  z: number
}

export const tileKey = (t: TileId) => `${t.z}/${t.x}/${t.y}`

/** Tiles at zoom z covering a lon/lat box, clipped to the world. */
export function tilesCovering(
  box: [number, number, number, number],
  z: number,
): { x0: number; x1: number; y0: number; y1: number } | null {
  const n = 2 ** z
  const [w, s, e, nth] = box
  if (!(w < e && s < nth)) return null
  const x0 = Math.max(0, Math.floor(mercX(w) * n))
  const x1 = Math.min(n - 1, Math.floor(mercX(e) * n - 1e-9))
  const y0 = Math.max(0, Math.floor(mercY(nth) * n))
  const y1 = Math.min(n - 1, Math.floor(mercY(s) * n - 1e-9))
  if (x1 < x0 || y1 < y0) return null
  return { x0, x1, y0, y1 }
}

export function intersect(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] | null {
  const w = Math.max(a[0], b[0])
  const s = Math.max(a[1], b[1])
  const e = Math.min(a[2], b[2])
  const n = Math.min(a[3], b[3])
  return w < e && s < n ? [w, s, e, n] : null
}

/**
 * The tile zoom for a map zoom. MapLibre's zoom is in 512 px tiles, so a 256 px pyramid matches at
 * z + 1; the floor keeps a texel at or above one screen pixel until the next level is worth it.
 */
export function tileZoomFor(mapZoom: number, minZoom: number, maxZoom: number): number {
  return Math.min(Math.max(Math.floor(mapZoom + 1), minZoom), maxZoom)
}

/** Fractional texel position of a lon/lat inside tile t (256 px tiles unless given). */
export function texelIn(
  t: TileId,
  lng: number,
  lat: number,
  size = 256,
): { px: number; py: number } {
  const n = 2 ** t.z
  return { px: (mercX(lng) * n - t.x) * size, py: (mercY(lat) * n - t.y) * size }
}

export interface TileSource {
  /** Raw tile bytes, or undefined when the source has no tile there (no data, not an error). */
  get: (t: TileId, signal: AbortSignal) => Promise<ArrayBuffer | undefined>
  readonly key: string
}

// One PMTiles reader per archive URL, shared by every layer that names it; directories stay cached.
const archives = new Map<string, PMTiles>()
const ARCHIVE_CACHE = 48

export function pmtilesSource(url: string): TileSource {
  return {
    key: url,
    async get(t, signal) {
      let p = archives.get(url)
      if (!p) {
        p = new PMTiles(url)
        archives.set(url, p)
        if (archives.size > ARCHIVE_CACHE) archives.delete(archives.keys().next().value!)
      } else {
        // Refresh recency.
        archives.delete(url)
        archives.set(url, p)
      }
      const res = await p.getZxy(t.z, t.x, t.y, signal)
      return res?.data
    },
  }
}

export function xyzSource(template: string): TileSource {
  return {
    key: template,
    async get(t, signal) {
      const url = template
        .replace('{z}', String(t.z))
        .replace('{x}', String(t.x))
        .replace('{y}', String(t.y))
      const res = await fetch(url, { signal })
      if (res.status === 404 || res.status === 204) return
      if (!res.ok) throw new Error(`tile ${res.status}`)
      return res.arrayBuffer()
    },
  }
}
