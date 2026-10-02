/**
 * Draw vector tiles onto MapKit through the async tile overlay.
 *
 * MapKit JS has no vector tile support: an overlay hands back an image per
 * tile. So this paints each tile to a canvas and returns it, which keeps a
 * dense network (millions of line features) off MapKit's own overlay list.
 *
 * The decode step is injected. That keeps this module free of protobuf
 * dependencies, lets an app run the decoder in a worker, and lets a test paint
 * fixture geometry without building a tile. Decoded tiles are cached, so
 * changing the style repaints from memory and never refetches.
 */

import { hitTestNeighbours, hitTestTile, projectToTilePoint } from './hit-test.js'

import type { VectorTileCoordinate, VectorTileHit } from './hit-test.js'

/** A fingertip, not a pixel. */
const DEFAULT_HIT_TOLERANCE_PX = 8

/**
 * Sentinel in `si` / `ri` columns when that feature did not carry the key.
 * A class-table lookup treats it as unknown, never as id 0.
 */
export const VECTOR_TILE_MISSING_ID = 0xffff_ffff

/** Reserved class byte: a gauge is on this stretch but is not reporting. */
export const VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING = 254

/**
 * Reserved class byte: no gauge on this stretch. Drawn in the style's
 * `noGauge` paint — a neutral water colour — not the unknown grey.
 */
export const VECTOR_TILE_CLASS_NO_GAUGE = 255

/** A decoded feature's properties, as a vector tile carries them. */
export type VectorTileProperties = Record<string, boolean | number | string | null>

export type VectorTileClassKey = 'si' | 'ri'

/**
 * Identity of the tile archive a class table must match.
 *
 * The table's declared version and length are compared to this, not guessed
 * from the bytes on a feature. A mismatch paints every feature as unknown
 * rather than a colour that belongs to a different network revision.
 */
export interface VectorTileNetworkIdentity {
  length: number
  version: number | string
}

/**
 * One byte per dense id (`si` or `ri`). Index `i` is the class of that id.
 *
 * `length` is the declared id-space, and must equal `classes.length` as well
 * as the tile archive's length. `networkVersion` is the revision those ids
 * were assigned under.
 */
export interface VectorTileClassTable {
  classes: Uint8Array
  length: number
  networkVersion: number | string
}

/**
 * A decoded tile, stored columnar rather than as objects.
 *
 * A tile of flowlines carries on the order of 10^5 points. One `{ x, y }`
 * object per point costs roughly 40 bytes once V8 has its header and pointer,
 * so the default 256-tile cache would retain about a gigabyte -- past what
 * mobile Safari gives a tab before it discards it. The same points in an
 * `Int16Array` cost 4 bytes, which is the difference between a cache that
 * survives a pan across the country and one that doesn't.
 *
 * `so`, `si` and `ri` are the same idea for the properties a national river
 * network styles by: one typed column per tile, not one object per feature.
 * A class-table style reads only those columns. The `properties` array stays
 * for the existing per-feature style function and for hit-test.
 *
 * Build one with {@link buildDecodedVectorTile} rather than by hand.
 */
export interface DecodedVectorTile {
  /**
   * Interleaved `x, y` pairs for every line in the tile, in tile-local
   * coordinates. `Int16Array` because a tile's own space is `0..extent` (4096
   * in every tile this library has seen) and a clip buffer adds a fraction of
   * that; see {@link buildDecodedVectorTile} for what happens further out.
   */
  coordinates: Int16Array
  /** Tile-local coordinate space, 4096 in every tile this library has seen. */
  extent: number
  /**
   * Where each feature's lines begin, as an index into `lineStarts`. Feature
   * `f` owns lines `featureLines[f]` up to `featureLines[f + 1]`, so the length
   * is one more than the feature count.
   */
  featureLines: Uint32Array
  /**
   * Where each line begins, as a *point* index into `coordinates`. Line `l`
   * runs from point `lineStarts[l]` up to `lineStarts[l + 1]`, so the length is
   * one more than the line count.
   */
  lineStarts: Uint32Array
  /** One entry per feature, in the order `featureLines` indexes them. */
  properties: readonly VectorTileProperties[]
  /**
   * Reach index per feature, present from zoom 8 in tiles v2. Omitted when no
   * feature in the tile carried `ri` (a v1 low-zoom tile).
   */
  ri?: Uint32Array
  /**
   * Dense segment id per feature, present at every zoom in tiles v2. Omitted
   * when no feature carried `si` — that is a v1 tile, and it still paints.
   */
  si?: Uint32Array
  /** Stream order per feature. Omitted when no feature carried `so`. */
  so?: Uint8Array
}

/** A feature as a caller describes it, before it is packed into flat arrays. */
export interface VectorTileFeatureInput {
  /** One entry per line; each is a run of tile-local points. */
  lines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>
  properties: VectorTileProperties
  /** Overrides `properties.ri` when packing the `ri` column. */
  ri?: number
  /** Overrides `properties.si` when packing the `si` column. */
  si?: number
  /** Overrides `properties.so` when packing the `so` column. */
  so?: number
}

/** Int16 range, the bound {@link buildDecodedVectorTile} clamps coordinates to. */
const COORDINATE_MIN = -32_768
const COORDINATE_MAX = 32_767

/**
 * Pack features into the columnar layout {@link DecodedVectorTile} holds.
 *
 * Coordinates are clamped into the `Int16Array` range. In a tile whose extent
 * is 4096 that bound is eight tile widths away from the tile, so a clamped
 * point is far outside the canvas either way and the clamp cannot change a
 * pixel -- it only stops a wildly out-of-range producer from wrapping a line
 * back across the tile.
 *
 * A line of fewer than two points is dropped: it can't be stroked, and keeping
 * it would put empty ranges in `lineStarts` for the painter to skip.
 *
 * `so`, `si` and `ri` become typed columns when at least one feature carries
 * them. A missing id in an otherwise-present `si`/`ri` column is
 * {@link VECTOR_TILE_MISSING_ID}, so a class-table lookup cannot mistake it
 * for id 0.
 */
export function buildDecodedVectorTile(
  extent: number,
  features: readonly VectorTileFeatureInput[],
): DecodedVectorTile {
  let pointCount = 0
  let lineCount = 0
  for (const feature of features) {
    for (const line of feature.lines) {
      if (line.length < 2) continue
      lineCount += 1
      pointCount += line.length
    }
  }

  const coordinates = new Int16Array(pointCount * 2)
  const lineStarts = new Uint32Array(lineCount + 1)
  const featureLines = new Uint32Array(features.length + 1)
  const properties: VectorTileProperties[] = []
  const so = new Uint8Array(features.length)
  const si = new Uint32Array(features.length)
  const ri = new Uint32Array(features.length)
  si.fill(VECTOR_TILE_MISSING_ID)
  ri.fill(VECTOR_TILE_MISSING_ID)
  let anySo = false
  let anySi = false
  let anyRi = false

  let pointIndex = 0
  let lineIndex = 0
  let featureIndex = 0
  for (const feature of features) {
    featureLines[featureIndex] = lineIndex
    for (const line of feature.lines) {
      if (line.length < 2) continue
      lineStarts[lineIndex] = pointIndex
      lineIndex += 1
      for (const point of line) {
        coordinates[pointIndex * 2] = clampCoordinate(point.x)
        coordinates[pointIndex * 2 + 1] = clampCoordinate(point.y)
        pointIndex += 1
      }
    }
    properties.push(feature.properties)
    const streamOrder = readColumnNumber(feature.so, feature.properties, 'so')
    if (streamOrder !== null) {
      anySo = true
      so[featureIndex] = clampByte(streamOrder)
    }
    const segmentId = readColumnNumber(feature.si, feature.properties, 'si')
    if (segmentId !== null) {
      anySi = true
      si[featureIndex] = toClassId(segmentId)
    }
    const reachId = readColumnNumber(feature.ri, feature.properties, 'ri')
    if (reachId !== null) {
      anyRi = true
      ri[featureIndex] = toClassId(reachId)
    }
    featureIndex += 1
  }
  lineStarts[lineIndex] = pointIndex
  featureLines[featureIndex] = lineIndex

  return {
    coordinates,
    extent,
    featureLines,
    lineStarts,
    properties,
    ...(anyRi ? { ri } : {}),
    ...(anySi ? { si } : {}),
    ...(anySo ? { so } : {}),
  }
}

function clampCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(COORDINATE_MAX, Math.max(COORDINATE_MIN, Math.round(value)))
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(255, Math.max(0, Math.round(value)))
}

function toClassId(value: number): number {
  if (!Number.isFinite(value) || value < 0) return VECTOR_TILE_MISSING_ID
  return Math.min(VECTOR_TILE_MISSING_ID, Math.round(value))
}

function readColumnNumber(
  explicit: number | undefined,
  properties: VectorTileProperties,
  key: string,
): number | null {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  const value = properties[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

/** Features in a decoded tile, which is one less than `featureLines.length`. */
export function vectorTileFeatureCount(tile: DecodedVectorTile): number {
  return Math.max(0, tile.featureLines.length - 1)
}

/** How a feature is painted, or `null` to skip it at this zoom. */
export interface VectorTileStyle {
  /**
   * Optional outline drawn under the line so it stays readable on the
   * basemap. `extraWidth` is added to `width` for that stroke only.
   */
  casing?: VectorTileCasing
  color: string
  opacity?: number
  /**
   * Draw-order key after stream order. Higher sits on top. A class-table
   * style uses the class byte; a function style may set this explicitly.
   */
  severity?: number
  /** Line width in CSS pixels, before the device pixel ratio. */
  width: number
}

export interface VectorTileCasing {
  color: string
  extraWidth: number
}

export type VectorTileStyleFunction = (
  properties: VectorTileProperties,
  zoom: number,
) => VectorTileStyle | null

/**
 * Colour by a class byte looked up in a table, not by calling a style
 * function per feature.
 *
 * Below `zoomThreshold` the table is indexed by `keyBelowZoom` (`si` by
 * default); from that zoom it is indexed by `keyFromZoom` (`ri` by default).
 * Reserved bytes stay distinct from `paintByClass` even if that array has
 * entries at 254 or 255.
 */
export interface VectorTileClassStyle {
  /**
   * Outline drawn under every batch. A per-feature `casing` on the resolved
   * paint, if present, wins for that feature.
   */
  casing?: VectorTileCasing
  classTable: VectorTileClassTable
  gaugeNotReporting: VectorTileStyle
  keyBelowZoom?: VectorTileClassKey
  keyFromZoom?: VectorTileClassKey
  noGauge: VectorTileStyle
  /**
   * Paint for class bytes 0–253. A missing entry, and every reserved or
   * unknown state, uses `unknown` / `gaugeNotReporting` / `noGauge` instead.
   */
  paintByClass: ReadonlyArray<VectorTileStyle | null | undefined>
  /**
   * Archive this style was built for. When omitted, the overlay source's
   * `tileNetwork` is the one compared to the table.
   */
  tileNetwork?: VectorTileNetworkIdentity
  unknown: VectorTileStyle
  zoomThreshold?: number
}

export type VectorTileOverlayStyle = VectorTileStyleFunction | VectorTileClassStyle

export function isVectorTileClassStyle(
  style: VectorTileOverlayStyle,
): style is VectorTileClassStyle {
  return typeof style === 'object' && style !== null && 'classTable' in style
}

/**
 * Turn tile bytes into geometry.
 *
 * Return `null` for a tile that holds nothing to draw -- the same class of
 * answer as an archive with no tile at that address, and not a failure, so it
 * is not reported to `onError`. A tile that is present but malformed should
 * throw instead; that is what a caller wants counted.
 */
export type VectorTileDecoder = (
  bytes: Uint8Array,
  tile: { x: number; y: number; z: number },
) => Promise<DecodedVectorTile | null>

/** The 2D canvas surface the painter needs, narrowed to what it calls. */
export interface VectorTileCanvas {
  height: number
  width: number
  getContext: (contextId: '2d') => VectorTileCanvasContext | null
}

export interface VectorTileCanvasContext {
  lineCap: string
  lineJoin: string
  lineWidth: number
  /**
   * The painter only ever writes a CSS color string. The union is what makes
   * a DOM `CanvasRenderingContext2D` — whose own `strokeStyle` also accepts a
   * gradient or a pattern — assignable to this interface.
   */
  strokeStyle: string | object
  globalAlpha: number
  beginPath: () => void
  clearRect: (x: number, y: number, width: number, height: number) => void
  lineTo: (x: number, y: number) => void
  moveTo: (x: number, y: number) => void
  stroke: () => void
}

/**
 * The registry half of a restyle. Structural so `./client` does not have to
 * name `MapKitLayerRegistry` here: any object that can `replace` a layer
 * with `activateWhen: 'first-image'` is enough.
 */
export interface VectorTileRestyleHost<TImage = unknown> {
  descriptor?: {
    data?: unknown
    maximumZ?: number
    minimumZ?: number
    onTileError?: (reason: unknown) => void
    opacity?: number
    order?: number
  }
  layerId: string
  replace: (
    id: string,
    descriptor: {
      data?: unknown
      id: string
      imageForTile: (
        x: number,
        y: number,
        z: number,
        scale: number,
        data?: unknown,
      ) => Promise<TImage | null>
      maximumZ?: number
      minimumZ?: number
      onTileError?: (reason: unknown) => void
      opacity?: number
      order?: number
    },
    options?: VectorTileRestyleReplaceOptions,
  ) => Promise<void>
  replaceOptions?: VectorTileRestyleReplaceOptions
}

export interface VectorTileRestyleReplaceOptions {
  activateWhen?: 'immediate' | 'first-image'
  crossfadeDurationMs?: number
  readinessTimeoutMs?: number
  signal?: AbortSignal
}

/**
 * Where a tile source reports the deepest zoom its archive holds. A
 * {@link PmTilesTileSource} does, from the archive header.
 */
export interface VectorTileArchive {
  getMaxZoom?: () => number | Promise<number | undefined> | undefined
}

export interface VectorTileOverlaySourceOptions<TCanvas extends VectorTileCanvas> {
  /**
   * The tile source, when it can say how deep the archive goes. Used for the
   * default `maxDataZoom`. Optional, and only read when `maxDataZoom` is unset.
   */
  archive?: VectorTileArchive
  /**
   * Decoded-tile cache budget in bytes, by {@link decodedVectorTileBytes}. Least
   * recently used tiles are evicted to stay under it. Default
   * {@link DEFAULT_VECTOR_TILE_CACHE_BYTES}; `Infinity` means no byte cap. A
   * tile larger than the whole budget still paints but is not retained.
   */
  cacheBytes?: number
  /**
   * Decoded-tile count cap. Default 256. It holds alongside `cacheBytes`:
   * whichever limit is reached first evicts.
   */
  cacheSize?: number
  createCanvas: (width: number, height: number) => TCanvas
  decode: VectorTileDecoder
  /**
   * The deepest zoom the archive has data for. A tile asked for above it is
   * painted from its ancestor at this zoom, scaled and clipped into the child,
   * so the archive is read and decoded once for every descendant.
   * Default: `archive.getMaxZoom()` when that exists, else no overzoom.
   */
  maxDataZoom?: number
  /**
   * Reported per tile; the tile itself resolves to `null` and draws nothing.
   * A read that was dropped or aborted because the map left its zoom is not an
   * error and is not reported.
   */
  onError?: (reason: unknown) => void
  /**
   * Tile reads in flight at once, default 6. Reads past it wait in a queue
   * served newest first; see {@link createVectorTileOverlaySource}.
   */
  readConcurrency?: number
  restyleHost?: VectorTileRestyleHost<TCanvas>
  style: VectorTileOverlayStyle
  /**
   * Read one tile's bytes. `signal` aborts when the map has left the tile's
   * zoom; pass it to the range fetch. Resolve `null` or reject once it aborts.
   */
  tileBytes: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Uint8Array | null>
  /**
   * Version and id-space the loaded tiles were built for. A class table that
   * does not declare the same pair paints every feature as unknown.
   */
  tileNetwork?: VectorTileNetworkIdentity
  /** Logical tile size before `scale`. MapKit asks for 256 or 512. */
  tileSize?: number
}

export interface VectorTileHitTestOptions {
  coordinate: VectorTileCoordinate
  /**
   * Screen-pixel radius around the probe. The default is a fingertip rather
   * than a pixel: a one-pixel-wide river is unhittable by touch otherwise.
   */
  tolerancePx?: number
  /** The zoom the map is displaying, which decides which tiles are consulted. */
  zoom: number
}

export interface VectorTileOverlaySource<TCanvas extends VectorTileCanvas> {
  /** Retained bytes, exact for geometry and estimated for properties. */
  readonly cacheBytes: number
  /** Drop every decoded tile, for example when the archive is replaced. */
  clearCache: () => void
  /**
   * The nearest feature to a coordinate, or `null`.
   *
   * Synchronous and cache-only: a tap must be answered during the gesture, and
   * a tile the user can see has already been decoded to be drawn. It never
   * fetches, so a probe over a tile that has not loaded yet is a miss.
   *
   * Above the data zoom the probe is answered from the ancestor tile, and the
   * hit's `tile` is that ancestor -- the tile `feature` indexes into.
   */
  hitTest: (options: VectorTileHitTestOptions) => VectorTileHit | null
  /** Pass to `createMapKitAsyncTileOverlay` or a `MapKitAsyncLayerDescriptor`. */
  imageForTile: (x: number, y: number, z: number, scale: number) => Promise<TCanvas | null>
  /**
   * Repaint from the decoded cache and, when a restyle host is attached,
   * swap the overlay through the registry's swap-when-drawn path. Rapid
   * successive calls coalesce to the latest style.
   */
  restyle: (style: VectorTileOverlayStyle) => Promise<void>
  /**
   * Replace the class table and restyle. A table whose version or length
   * does not match the tiles draws unknown, never a wrong colour.
   */
  setClassTable: (table: VectorTileClassTable) => Promise<void>
  setRestyleHost: (host: VectorTileRestyleHost<TCanvas> | null) => void
  /**
   * Swap the style in memory. Cached tiles repaint on the next request
   * without a refetch or a re-decode. Prefer {@link VectorTileOverlaySource.restyle}
   * when the overlay is on a map: `setStyle` alone cannot ask MapKit to
   * re-request tiles without a blank frame.
   */
  setStyle: (style: VectorTileOverlayStyle) => void
  /** Decoded tiles held right now. */
  readonly size: number
}

/**
 * Bytes a decoded tile retains.
 *
 * Geometry, indexes and class columns are exact. Properties are estimated,
 * because they are ordinary objects and only the engine knows their real
 * footprint -- but leaving them out would understate a dense archive badly,
 * since a `name` string on each of a few thousand features per tile is what
 * actually grows the cache. The estimate charges two bytes per character of
 * every key and string value, eight for a number, and a flat per-entry
 * overhead; it is meant for sizing `cacheSize` against a budget, not for
 * exact accounting.
 */
export function decodedVectorTileBytes(tile: DecodedVectorTile): number {
  return (
    tile.coordinates.byteLength +
    tile.lineStarts.byteLength +
    tile.featureLines.byteLength +
    (tile.so?.byteLength ?? 0) +
    (tile.si?.byteLength ?? 0) +
    (tile.ri?.byteLength ?? 0) +
    estimatePropertyBytes(tile.properties)
  )
}

/** Per property entry: a key slot, a value slot and the map overhead around them. */
const PROPERTY_ENTRY_OVERHEAD = 32

function estimatePropertyBytes(properties: readonly VectorTileProperties[]): number {
  let bytes = 0
  for (const entry of properties) {
    for (const key in entry) {
      const value = entry[key]
      bytes += PROPERTY_ENTRY_OVERHEAD + key.length * 2
      if (typeof value === 'string') bytes += value.length * 2
      else if (typeof value === 'number') bytes += 8
    }
  }
  return bytes
}

/**
 * Default decoded-tile budget, in bytes.
 *
 * A dense river-network tile (about 10^5 points and a couple of thousand
 * features) retains roughly 0.7 MB by {@link decodedVectorTileBytes}; 64 MiB
 * holds on the order of ninety of them, several screens of a phone map plus the
 * ring MapKit prefetches, and a third of what the old 256-tile count cap would
 * have kept for the same tiles. See the measurement in the pull request that
 * introduced it (narduk-libs#1345 L6) and the README. Pass `cacheBytes:
 * Infinity` to cap by count only.
 */
export const DEFAULT_VECTOR_TILE_CACHE_BYTES = 64 * 1024 * 1024

/**
 * LRU over decoded tiles, capped by count and by total decoded bytes.
 *
 * Map preserves insertion order, so the first key is the least recently used.
 * A tile larger than the whole byte budget is not retained at all -- keeping it
 * would evict everything else for one tile -- but the caller still has it in
 * hand to paint.
 */
class TileCache {
  readonly #byteLimit: number
  readonly #limit: number
  readonly #tiles = new Map<string, { bytes: number; tile: DecodedVectorTile }>()
  #bytes = 0

  constructor(limit: number, byteLimit: number) {
    this.#limit = Math.max(1, limit)
    this.#byteLimit = Number.isNaN(byteLimit) ? Number.POSITIVE_INFINITY : Math.max(0, byteLimit)
  }

  get bytes() {
    return this.#bytes
  }

  get size() {
    return this.#tiles.size
  }

  clear() {
    this.#tiles.clear()
    this.#bytes = 0
  }

  get(key: string) {
    const entry = this.#tiles.get(key)
    if (!entry) return null
    this.#tiles.delete(key)
    this.#tiles.set(key, entry)
    return entry.tile
  }

  set(key: string, tile: DecodedVectorTile) {
    this.#drop(key)
    const bytes = decodedVectorTileBytes(tile)
    if (bytes > this.#byteLimit) return
    this.#tiles.set(key, { bytes, tile })
    this.#bytes += bytes
    while (this.#tiles.size > this.#limit || this.#bytes > this.#byteLimit) {
      const oldest = this.#tiles.keys().next().value
      if (oldest === undefined) break
      this.#drop(oldest)
    }
  }

  #drop(key: string) {
    const existing = this.#tiles.get(key)
    if (!existing) return
    this.#bytes -= existing.bytes
    this.#tiles.delete(key)
  }
}

export const DEFAULT_VECTOR_TILE_CLASS_ZOOM_THRESHOLD = 8

/** Reads in flight at once unless `readConcurrency` says otherwise. */
export const DEFAULT_VECTOR_TILE_READ_CONCURRENCY = 6

/**
 * Whether a class table may colour these tiles.
 *
 * The table's own `length` must equal `classes.length`. When a tile-network
 * identity is supplied it must also match the table's declared version and
 * length. Anything else is a different network, and the painter must not
 * guess.
 */
export function classTableMatchesNetwork(
  table: VectorTileClassTable,
  tileNetwork?: VectorTileNetworkIdentity,
): boolean {
  if (table.length !== table.classes.length) return false
  if (!tileNetwork) return true
  return table.networkVersion === tileNetwork.version && table.length === tileNetwork.length
}

/** Which column a class-table style reads at `zoom`. */
export function vectorTileClassKeyAtZoom(
  style: VectorTileClassStyle,
  zoom: number,
): VectorTileClassKey {
  const threshold = style.zoomThreshold ?? DEFAULT_VECTOR_TILE_CLASS_ZOOM_THRESHOLD
  return zoom < threshold ? (style.keyBelowZoom ?? 'si') : (style.keyFromZoom ?? 'ri')
}

/**
 * Class byte for one feature, or `null` when the chosen column is absent,
 * the id is missing, or the id sits outside the table.
 *
 * `null` is "no data", never 0 and never a reserved byte.
 */
export function vectorTileClassByte(
  tile: DecodedVectorTile,
  feature: number,
  key: VectorTileClassKey,
  table: VectorTileClassTable,
): number | null {
  const column = key === 'si' ? tile.si : tile.ri
  if (!column) return null
  const id = column[feature]
  if (id === undefined || id === VECTOR_TILE_MISSING_ID) return null
  if (id >= table.classes.length) return null
  return table.classes[id] ?? null
}

/**
 * Paint for a looked-up class byte. Reserved 254/255 and unknown stay
 * distinct from `paintByClass`, including from any entry at those indexes.
 */
export function paintForVectorTileClass(
  style: VectorTileClassStyle,
  classByte: number | null,
  compatible: boolean,
): VectorTileStyle {
  let paint: VectorTileStyle
  if (!compatible || classByte === null) paint = style.unknown
  else if (classByte === VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING) paint = style.gaugeNotReporting
  else if (classByte === VECTOR_TILE_CLASS_NO_GAUGE) paint = style.noGauge
  else paint = style.paintByClass[classByte] ?? style.unknown
  const severity =
    paint.severity ??
    (compatible && classByte !== null && classByte < VECTOR_TILE_CLASS_GAUGE_NOT_REPORTING
      ? classByte
      : -1)
  return withCasing({ ...paint, severity }, style.casing)
}

function withCasing(
  paint: VectorTileStyle,
  fallback: VectorTileCasing | undefined,
): VectorTileStyle {
  if (paint.casing || !fallback) return paint
  return { ...paint, casing: fallback }
}

function resolveFeaturePaint(
  tile: DecodedVectorTile,
  feature: number,
  zoom: number,
  style: VectorTileOverlayStyle,
  tileNetwork: VectorTileNetworkIdentity | undefined,
): VectorTileStyle | null {
  if (isVectorTileClassStyle(style)) {
    const compatible = classTableMatchesNetwork(style.classTable, tileNetwork ?? style.tileNetwork)
    const key = vectorTileClassKeyAtZoom(style, zoom)
    const classByte = compatible ? vectorTileClassByte(tile, feature, key, style.classTable) : null
    return paintForVectorTileClass(style, classByte, compatible)
  }
  const properties = tile.properties[feature]
  if (!properties) return null
  return style(properties, zoom)
}

function streamOrderOf(tile: DecodedVectorTile, feature: number, properties: VectorTileProperties) {
  const column = tile.so?.[feature]
  if (column !== undefined) return column
  const value = properties.so
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function severityOf(paint: VectorTileStyle, properties: VectorTileProperties) {
  if (typeof paint.severity === 'number' && Number.isFinite(paint.severity)) return paint.severity
  const value = properties.severity
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function batchKey(paint: VectorTileStyle): string {
  const casing = paint.casing
  return [
    paint.color,
    String(paint.width),
    String(paint.opacity ?? 1),
    casing ? `${casing.color}:${casing.extraWidth}` : '',
  ].join('|')
}

function appendFeaturePath(
  context: VectorTileCanvasContext,
  tile: DecodedVectorTile,
  feature: number,
  scale: number,
): boolean {
  const { coordinates, featureLines, lineStarts } = tile
  const lastLine = featureLines[feature + 1] ?? 0
  let added = false
  for (let line = featureLines[feature] ?? 0; line < lastLine; line += 1) {
    const start = lineStarts[line] ?? 0
    const end = lineStarts[line + 1] ?? start
    if (end - start < 2) continue
    context.moveTo((coordinates[start * 2] ?? 0) * scale, (coordinates[start * 2 + 1] ?? 0) * scale)
    for (let point = start + 1; point < end; point += 1) {
      context.lineTo(
        (coordinates[point * 2] ?? 0) * scale,
        (coordinates[point * 2 + 1] ?? 0) * scale,
      )
    }
    added = true
  }
  return added
}

/**
 * Which part of an ancestor tile a child tile shows, for overzoom.
 *
 * The child is `levels` zooms deeper than the decoded tile, so it covers
 * `1 / 2 ** levels` of the ancestor's width and height, starting at `column` /
 * `row` in units of that fraction.
 */
export interface VectorTileOverzoom {
  /** The child's column within the ancestor, `0` to `2 ** levels - 1`. */
  column: number
  /** Zoom levels between the decoded tile and the tile being painted. */
  levels: number
  /** The child's row within the ancestor, `0` to `2 ** levels - 1`. */
  row: number
}

/** The window of an ancestor tile a child shows, and how it maps to pixels. */
interface OverzoomView {
  /** Pixels per tile unit. */
  scale: number
  /** Clip window in tile units, widened by a line width so a stroke at the edge is whole. */
  x0: number
  x1: number
  y0: number
  y1: number
  /** Window origin in tile units. */
  originX: number
  originY: number
}

function overzoomView(
  overzoom: VectorTileOverzoom,
  extent: number,
  tileSize: number,
  pixelRatio: number,
  marginPx: number,
): OverzoomView {
  const span = extent / 2 ** overzoom.levels
  const originX = overzoom.column * span
  const originY = overzoom.row * span
  const scale = (tileSize * pixelRatio) / span
  const margin = marginPx / scale
  return {
    originX,
    originY,
    scale,
    x0: originX - margin,
    x1: originX + span + margin,
    y0: originY - margin,
    y1: originY + span + margin,
  }
}

/**
 * Clip the segment `a -> b` to the view window (Liang-Barsky). Returns the
 * parameter range `[t0, t1]` that lies inside, or `null` if none does.
 */
function clipSegment(
  view: OverzoomView,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number] | null {
  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  const edges: Array<[number, number]> = [
    [-dx, ax - view.x0],
    [dx, view.x1 - ax],
    [-dy, ay - view.y0],
    [dy, view.y1 - ay],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const t = q / p
    if (p < 0) {
      if (t > t1) return null
      if (t > t0) t0 = t
    } else {
      if (t < t0) return null
      if (t < t1) t1 = t
    }
  }
  return [t0, t1]
}

/**
 * Like {@link appendFeaturePath}, for a child of the decoded tile: points are
 * moved into the child's pixel frame and each line is cut to the child's
 * window, so a river that crosses the edge ends there instead of running off
 * to coordinates the canvas has to clip.
 */
function appendOverzoomFeaturePath(
  context: VectorTileCanvasContext,
  tile: DecodedVectorTile,
  feature: number,
  view: OverzoomView,
): boolean {
  const { coordinates, featureLines, lineStarts } = tile
  const lastLine = featureLines[feature + 1] ?? 0
  const { originX, originY, scale } = view
  let added = false
  for (let line = featureLines[feature] ?? 0; line < lastLine; line += 1) {
    const start = lineStarts[line] ?? 0
    const end = lineStarts[line + 1] ?? start
    let open = false
    for (let point = start; point + 1 < end; point += 1) {
      const ax = coordinates[point * 2] ?? 0
      const ay = coordinates[point * 2 + 1] ?? 0
      const bx = coordinates[point * 2 + 2] ?? 0
      const by = coordinates[point * 2 + 3] ?? 0
      const range = clipSegment(view, ax, ay, bx, by)
      if (!range) {
        open = false
        continue
      }
      const [t0, t1] = range
      if (!open || t0 > 0) {
        context.moveTo(
          (ax + (bx - ax) * t0 - originX) * scale,
          (ay + (by - ay) * t0 - originY) * scale,
        )
      }
      context.lineTo(
        (ax + (bx - ax) * t1 - originX) * scale,
        (ay + (by - ay) * t1 - originY) * scale,
      )
      open = t1 === 1
      added = true
    }
  }
  return added
}

/**
 * Paint one decoded tile. Exported because the hit-test and the overlay need
 * the same tile-to-pixel mapping, and a test can call it directly.
 *
 * Lines are grouped by colour and width into one stroke per batch, then
 * drawn in stream-order then severity so a flooded stretch sits on top of
 * the same-order water under it. An optional casing is the same path,
 * stroked wider, underneath the batch.
 */
export function paintVectorTile(
  canvas: VectorTileCanvas,
  tile: DecodedVectorTile,
  options: {
    /**
     * Paint a child of `tile` -- a tile `levels` zooms deeper -- from its
     * geometry, scaled and clipped into the child. `zoom` stays the zoom being
     * displayed: line width, the style function and the class-table key all
     * follow it, while the columns come from `tile`.
     */
    overzoom?: VectorTileOverzoom
    pixelRatio: number
    style: VectorTileOverlayStyle
    tileNetwork?: VectorTileNetworkIdentity
    tileSize: number
    zoom: number
  },
): boolean {
  const context = canvas.getContext('2d')
  if (!context) return false
  const { overzoom, pixelRatio, style, tileNetwork, tileSize, zoom } = options
  const scale = (tileSize * pixelRatio) / tile.extent
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  const featureCount = vectorTileFeatureCount(tile)
  const paintedFeatures: Array<{
    feature: number
    key: string
    paint: VectorTileStyle
    severity: number
    so: number
  }> = []

  for (let feature = 0; feature < featureCount; feature += 1) {
    const paint = resolveFeaturePaint(tile, feature, zoom, style, tileNetwork)
    if (!paint) continue
    const properties = tile.properties[feature] ?? {}
    paintedFeatures.push({
      feature,
      key: batchKey(paint),
      paint,
      severity: severityOf(paint, properties),
      so: streamOrderOf(tile, feature, properties),
    })
  }

  paintedFeatures.sort((left, right) => left.so - right.so || left.severity - right.severity)

  let painted = false
  let index = 0
  while (index < paintedFeatures.length) {
    const head = paintedFeatures[index]
    if (!head) break
    const batch = [head]
    index += 1
    while (index < paintedFeatures.length) {
      const next = paintedFeatures[index]
      if (!next || next.key !== head.key) break
      batch.push(next)
      index += 1
    }

    context.beginPath()
    let added = false
    const paint = head.paint
    const view = overzoom
      ? overzoomView(
          overzoom,
          tile.extent,
          tileSize,
          pixelRatio,
          (paint.width + (paint.casing?.extraWidth ?? 0)) * pixelRatio,
        )
      : null
    for (const entry of batch) {
      const appended = view
        ? appendOverzoomFeaturePath(context, tile, entry.feature, view)
        : appendFeaturePath(context, tile, entry.feature, scale)
      if (appended) added = true
    }
    if (!added) continue

    context.globalAlpha = paint.opacity ?? 1
    if (paint.casing) {
      context.strokeStyle = paint.casing.color
      context.lineWidth = Math.max(
        (paint.width + paint.casing.extraWidth) * pixelRatio,
        pixelRatio * 0.5,
      )
      context.stroke()
    }
    context.strokeStyle = paint.color
    context.lineWidth = Math.max(paint.width * pixelRatio, pixelRatio * 0.5)
    context.stroke()
    painted = true
  }

  context.globalAlpha = 1
  return painted
}

/** A tile read, from the moment it is asked for until it settles. */
interface PendingRead {
  controller: AbortController
  generation: number
  key: string
  promise: Promise<DecodedVectorTile | null>
  settle: (value: DecodedVectorTile | null | Promise<DecodedVectorTile | null>) => void
  x: number
  y: number
  z: number
}

function normaliseMaxDataZoom(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

const DEFAULT_RESTYLE_REPLACE: VectorTileRestyleReplaceOptions = {
  activateWhen: 'first-image',
  crossfadeDurationMs: 0,
}

/**
 * Build the `imageForTile` function for a vector tile archive.
 *
 * An empty tile, a missing tile and a failed decode all resolve to `null`, so
 * MapKit draws nothing there instead of a blank square over the basemap.
 *
 * Reads go through a bounded queue (`readConcurrency`) served newest first. A
 * read for a zoom the map has since left is dropped before it starts, or
 * aborted through the `AbortSignal` handed to `tileBytes` if it already has.
 * Either way the tile resolves to `null`, is not reported to `onError`, is not
 * cached, and loads normally if it is asked for again.
 *
 * Above `maxDataZoom` a tile is painted from its ancestor at that zoom: one
 * read and one decode, shared by every descendant through the cache.
 */
export function createVectorTileOverlaySource<TCanvas extends VectorTileCanvas>(
  options: VectorTileOverlaySourceOptions<TCanvas>,
): VectorTileOverlaySource<TCanvas> {
  const {
    archive,
    cacheBytes: byteBudget = DEFAULT_VECTOR_TILE_CACHE_BYTES,
    cacheSize = 256,
    createCanvas,
    decode,
    onError,
    tileBytes,
    tileSize = 256,
  } = options
  const concurrency = Math.max(
    1,
    Math.floor(options.readConcurrency ?? DEFAULT_VECTOR_TILE_READ_CONCURRENCY) || 1,
  )
  const cache = new TileCache(cacheSize, byteBudget)
  // MapKit asks for a screenful at once and re-asks on every render pass, so
  // the same address is commonly requested again while its first read is
  // still in flight. Without this the archive is fetched twice and the tile
  // decoded twice, for one tile drawn.
  const inFlight = new Map<string, PendingRead>()
  // Reads wait here when `concurrency` are already running. Newest on top: the
  // tile the user is looking at now is the last one MapKit asked for.
  const queued: PendingRead[] = []
  const running = new Set<PendingRead>()
  // The zoom MapKit asked for most recently. A read for a zoom the map has
  // left is dropped (if queued) or aborted (if running).
  let latestZoom: number | null = null
  // Bumped by clearCache. A read started against the previous archive must
  // not land in the cache afterwards, so it is stamped with the generation it
  // belongs to and discarded if that moved.
  let generation = 0
  let style = options.style
  let classTable = isVectorTileClassStyle(options.style) ? options.style.classTable : null
  let restyleHost = options.restyleHost ?? null
  const tileNetwork = options.tileNetwork
  let restyleQueued = 0
  let restyleApplied = 0
  let restylePumping = false
  const restyleWaiters: Array<{
    epoch: number
    reject: (reason: unknown) => void
    resolve: () => void
  }> = []

  // The deepest zoom with data. `undefined` once settled means there is none.
  let maxDataZoom = normaliseMaxDataZoom(options.maxDataZoom)
  let maxDataZoomPending: Promise<void> | null = null
  if (maxDataZoom === undefined && options.maxDataZoom === undefined && archive?.getMaxZoom) {
    maxDataZoomPending = (async () => {
      try {
        maxDataZoom = normaliseMaxDataZoom(await archive.getMaxZoom?.())
      } catch {
        // No answer is no overzoom; the tile reads report their own failures.
      } finally {
        maxDataZoomPending = null
      }
    })()
  }

  function dataZoomFor(zoom: number): number {
    return maxDataZoom !== undefined && zoom > maxDataZoom ? maxDataZoom : zoom
  }

  function liveStyle(): VectorTileOverlayStyle {
    if (isVectorTileClassStyle(style) && classTable) {
      return { ...style, classTable }
    }
    return style
  }

  function paintOptions(zoom: number) {
    return {
      pixelRatio: 1,
      style: liveStyle(),
      tileSize,
      zoom,
      ...(tileNetwork ? { tileNetwork } : {}),
    }
  }

  function isStale(read: PendingRead) {
    return latestZoom !== null && read.z !== dataZoomFor(latestZoom)
  }

  /** Forget a read that will not complete, so the next ask starts a fresh one. */
  function release(read: PendingRead) {
    if (inFlight.get(read.key) === read) inFlight.delete(read.key)
  }

  /** Drop what is queued for a zoom the map has left; abort what is running. */
  function dropStale() {
    for (let index = queued.length - 1; index >= 0; index -= 1) {
      const read = queued[index]
      if (!read || !isStale(read)) continue
      queued.splice(index, 1)
      release(read)
      read.settle(null)
    }
    for (const read of running) {
      if (!isStale(read)) continue
      release(read)
      read.controller.abort()
    }
  }

  function pump() {
    while (running.size < concurrency) {
      const read = queued.pop()
      if (!read) return
      if (isStale(read)) {
        release(read)
        read.settle(null)
        continue
      }
      running.add(read)
      read.settle(execute(read))
    }
  }

  async function execute(read: PendingRead): Promise<DecodedVectorTile | null> {
    const { controller, generation: startedAt, key, x, y, z } = read
    let bytes: Uint8Array | null
    try {
      bytes = await tileBytes(z, x, y, controller.signal)
    } catch (reason) {
      // An aborted read is the map moving on, not a failure.
      if (controller.signal.aborted) return null
      throw reason
    } finally {
      running.delete(read)
      pump()
    }
    if (controller.signal.aborted || !bytes) return null
    const tile = await decode(bytes, { x, y, z })
    if (!tile) return null
    if (startedAt === generation) cache.set(key, tile)
    return tile
  }

  function decodedTile(z: number, x: number, y: number) {
    const key = `${z}/${x}/${y}`
    const cached = cache.get(key)
    if (cached) return Promise.resolve(cached)
    const existing = inFlight.get(key)
    if (existing) return existing.promise
    let settle!: (value: DecodedVectorTile | null | Promise<DecodedVectorTile | null>) => void
    const read: PendingRead = {
      controller: new AbortController(),
      generation,
      key,
      promise: new Promise<DecodedVectorTile | null>((resolve) => {
        settle = resolve
      }),
      settle: (value) => settle(value),
      x,
      y,
      z,
    }
    // Only if it is still this read: clearCache may have dropped the entry
    // and a newer read may already own the key.
    void read.promise.then(
      () => release(read),
      () => release(read),
    )
    inFlight.set(key, read)
    queued.push(read)
    pump()
    return read.promise
  }

  async function imageForTile(x: number, y: number, z: number, scale: number) {
    try {
      if (maxDataZoomPending) await maxDataZoomPending
      latestZoom = z
      dropStale()
      // Above the archive's last zoom the data lives in one ancestor, shared
      // by every descendant through the cache.
      const levels = z - dataZoomFor(z)
      const factor = 2 ** levels
      const ancestorX = Math.floor(x / factor)
      const ancestorY = Math.floor(y / factor)
      const tile = await decodedTile(z - levels, ancestorX, ancestorY)
      if (!tile || vectorTileFeatureCount(tile) === 0) return null
      const pixelRatio = scale > 0 ? scale : 1
      const size = Math.round(tileSize * pixelRatio)
      const canvas = createCanvas(size, size)
      const painted = paintVectorTile(canvas, tile, {
        ...paintOptions(z),
        pixelRatio,
        ...(levels > 0
          ? { overzoom: { column: x - ancestorX * factor, levels, row: y - ancestorY * factor } }
          : {}),
      })
      return painted ? canvas : null
    } catch (reason) {
      onError?.(reason)
      return null
    }
  }

  function requestRestyle(): Promise<void> {
    const epoch = ++restyleQueued
    const done = new Promise<void>((resolve, reject) => {
      restyleWaiters.push({ epoch, reject, resolve })
    })
    void pumpRestyle()
    return done
  }

  function settleWaiters(upTo: number, error?: unknown) {
    const remaining: typeof restyleWaiters = []
    for (const waiter of restyleWaiters) {
      if (waiter.epoch > upTo) {
        remaining.push(waiter)
        continue
      }
      if (error) waiter.reject(error)
      else waiter.resolve()
    }
    restyleWaiters.length = 0
    restyleWaiters.push(...remaining)
  }

  async function pumpRestyle() {
    if (restylePumping) return
    restylePumping = true
    try {
      // Collapse a same-turn burst (lens + theme + table) to one swap.
      await Promise.resolve()
      while (restyleApplied !== restyleQueued) {
        const target = restyleQueued
        const host = restyleHost
        if (host) {
          const descriptor = {
            ...host.descriptor,
            id: host.layerId,
            imageForTile,
          }
          await host.replace(host.layerId, descriptor, {
            ...DEFAULT_RESTYLE_REPLACE,
            ...host.replaceOptions,
          })
        }
        restyleApplied = target
        settleWaiters(target)
      }
    } catch (reason) {
      settleWaiters(restyleQueued, reason)
      restyleApplied = restyleQueued
    } finally {
      restylePumping = false
      if (restyleApplied !== restyleQueued) void pumpRestyle()
    }
  }

  return {
    get cacheBytes() {
      return cache.bytes
    },
    clearCache() {
      cache.clear()
      generation += 1
      inFlight.clear()
    },
    hitTest({ coordinate, tolerancePx = DEFAULT_HIT_TOLERANCE_PX, zoom }) {
      // Everything is computed in tile fractions and converted per tile, so a
      // source whose tiles use different extents still compares like for like.
      // Above the data zoom the tiles are the ancestors', and a displayed tile
      // is `1 / 2 ** levels` of one, so a pixel is that much smaller a fraction.
      const dataZoom = dataZoomFor(zoom)
      const pixelsPerTile = tileSize * 2 ** (zoom - dataZoom)
      const point = projectToTilePoint(coordinate, dataZoom, 1)
      const tolerance = tolerancePx / pixelsPerTile
      let best: VectorTileHit | null = null

      for (const candidate of hitTestNeighbours(point, dataZoom, 1, tolerance)) {
        const tile = cache.get(`${dataZoom}/${candidate.offsetX}/${candidate.offsetY}`)
        if (!tile) continue
        const hit = hitTestTile(
          tile,
          candidate.x * tile.extent,
          candidate.y * tile.extent,
          tolerance * tile.extent,
        )
        if (!hit) continue
        const distancePx = (hit.distance / tile.extent) * pixelsPerTile
        if (best && best.distancePx <= distancePx) continue
        best = {
          distancePx,
          feature: hit.feature,
          properties: tile.properties[hit.feature] ?? {},
          tile: { x: candidate.offsetX, y: candidate.offsetY, z: dataZoom },
        }
      }

      return best
    },
    imageForTile,
    restyle(next) {
      style = next
      classTable = isVectorTileClassStyle(next) ? next.classTable : classTable
      return requestRestyle()
    },
    setClassTable(table) {
      classTable = table
      if (isVectorTileClassStyle(style)) style = { ...style, classTable: table }
      return requestRestyle()
    },
    setRestyleHost(host) {
      restyleHost = host
    },
    get size() {
      return cache.size
    },
    setStyle(next) {
      style = next
      if (isVectorTileClassStyle(next)) classTable = next.classTable
    },
  }
}
