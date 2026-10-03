/**
 * Decode Mapbox Vector Tiles into the columnar shape the painter draws.
 *
 * This is the one place in the package that depends on protobuf. It lives
 * behind its own entry so `./client` -- which every map consumer imports --
 * never pulls `@mapbox/vector-tile` or `pbf` into a bundle, and so this half
 * can be loaded inside a worker on its own.
 */
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'

import { buildDecodedVectorTile } from '../client/vector-tiles.js'

import type {
  DecodedVectorTile,
  VectorTileDecoder,
  VectorTileFeatureInput,
  VectorTileProperties,
} from '../client/vector-tiles.js'

export interface MvtDecoderOptions {
  /**
   * Layers to read, in the archive's own naming. Omit to read every layer.
   * Naming them is cheaper than filtering later: an unread layer is never
   * walked, and a tile product often carries labels beside the geometry.
   */
  layers?: readonly string[]
  /**
   * Property keys to keep. Omit to keep every key.
   *
   * Worth setting on a dense archive: leftover strings are the only part of a
   * decoded tile that is not a flat buffer. `so`, `si` and `ri` become typed
   * columns either way; dropping `name` is what actually shrinks the cache.
   */
  properties?: readonly string[]
}

/**
 * Build a {@link VectorTileDecoder} over `@mapbox/vector-tile`.
 *
 * Point features fall out on their own: a run of fewer than two points cannot
 * be stroked, and {@link buildDecodedVectorTile} drops it. Polygon rings are
 * kept and stroked as lines, which is what an outline wants.
 *
 * The empty/failed split follows the {@link VectorTileDecoder} contract:
 * empty bytes, a tile whose layers the filter excludes, and a layer with no
 * features all decode to `null`, which is "nothing to draw" and not worth
 * reporting. Bytes that are present but hold no layer at all are not a vector
 * tile, so they throw -- that is a wrong archive or a truncated read, and a
 * caller wants it counted rather than silently drawn as blank country.
 */
export function createMvtDecoder(options: MvtDecoderOptions = {}): VectorTileDecoder {
  const layerFilter = options.layers ? new Set(options.layers) : null
  const propertyFilter = options.properties ? new Set(options.properties) : null

  // The failure is returned, never thrown at the caller: a decoder that
  // throws synchronously would escape the overlay's `try` around the await.
  return (bytes) => {
    try {
      return Promise.resolve(decodeMvt(bytes, layerFilter, propertyFilter))
    } catch (reason) {
      return Promise.reject(reason instanceof Error ? reason : new Error(String(reason)))
    }
  }
}

/** The synchronous core, so a worker can call it without a microtask hop. */
export function decodeMvtTile(
  bytes: Uint8Array,
  options: MvtDecoderOptions = {},
): DecodedVectorTile | null {
  return decodeMvt(
    bytes,
    options.layers ? new Set(options.layers) : null,
    options.properties ? new Set(options.properties) : null,
  )
}

function decodeMvt(
  bytes: Uint8Array,
  layerFilter: ReadonlySet<string> | null,
  propertyFilter: ReadonlySet<string> | null,
): DecodedVectorTile | null {
  if (bytes.length === 0) return null
  let tile: VectorTile
  try {
    tile = new VectorTile(new PbfReader(bytes))
  } catch (reason) {
    // pbf's own message ("Unimplemented type: 4") says nothing a caller can
    // act on; what they need to know is that the body is not a tile.
    throw new Error(`not a vector tile: ${bytes.length} bytes failed to parse`, { cause: reason })
  }
  const present = Object.keys(tile.layers)
  if (present.length === 0) {
    // `@mapbox/vector-tile` drops a layer that declares no feature, so an
    // empty tile and a body that is not a tile at all both land here. Tell
    // them apart by the wire itself: a tile carries its layers in field 3.
    if (hasLayerField(bytes)) return null
    throw new Error(`not a vector tile: no layer field in ${bytes.length} bytes`)
  }
  const names = present.filter((name) => !layerFilter || layerFilter.has(name))
  if (names.length === 0) return null

  // Layers may declare different extents. Scale every layer onto the largest
  // one rather than the first, so the rescale only ever adds precision. A
  // coarse grid is lifted to FINE_EXTENT so its smoothed points keep their
  // sub-unit positions through the Int16 packing.
  let extent = 0
  for (const name of names) {
    const layer = tile.layers[name]
    if (layer) extent = Math.max(extent, layer.extent)
  }
  if (extent <= 0) return null
  if (extent < FINE_EXTENT) extent = FINE_EXTENT

  const features: VectorTileFeatureInput[] = []
  for (const name of names) {
    const layer = tile.layers[name]
    if (!layer) continue
    const scale = extent / layer.extent
    const start = features.length
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index)
      const lines = feature.loadGeometry()
      if (lines.length === 0) continue
      features.push({ lines, properties: readProperties(feature.properties, propertyFilter) })
    }
    const own = features.slice(start)
    const smoothed =
      layer.extent < FINE_EXTENT ? smoothCoarseNetwork(own.map((feature) => feature.lines)) : null
    if (scale === 1 && !smoothed) continue
    for (const [offset, feature] of own.entries()) {
      const lines = smoothed?.[offset] ?? feature.lines
      features[start + offset] = {
        ...feature,
        lines: lines.map((line) =>
          line.map((point) => ({ x: point.x * scale, y: point.y * scale })),
        ),
      }
    }
  }

  if (features.length === 0) return null
  return buildDecodedVectorTile(extent, features)
}

/** A layer on a grid coarser than this has its grid staircases smoothed. */
const FINE_EXTENT = 4096

/** Smoothing passes over a coarse layer's network; see {@link smoothCoarseNetwork}. */
const SMOOTHING_PASSES = 2

/**
 * Take the staircase a coarse tile grid leaves out of a layer's lines.
 *
 * A low-zoom tile built on a 256 or 512 grid quantises every gentle curve into
 * horizontal and vertical unit steps, and river-network v3 stores those steps
 * as separate two-point lines (about 2.1 points a line at z3 and z4). Drawn on
 * a 2x or 3x canvas each step is a visible stair and the network reads as a
 * blocky mesh. No single line holds a staircase, so this works on the layer's
 * whole network: every point is a node, joined to the points it is drawn to.
 * A node joined to exactly two others (the middle of a run, whichever lines
 * carry it) moves halfway towards their average, `SMOOTHING_PASSES` times;
 * a staircase of unit steps becomes a straight line about a third of a unit
 * from its centre. Junctions, ends and crossings (any other number of joins)
 * stay exactly where the tile put them, so lines still meet where they met,
 * and a shared point moves once for every line that carries it. Nothing moves
 * more than about one grid unit, which is the quantisation itself.
 *
 * Takes and returns one entry per feature, each a list of lines.
 */
export function smoothCoarseNetwork(
  features: ReadonlyArray<ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>>,
  passes = SMOOTHING_PASSES,
): Array<Array<Array<{ x: number; y: number }>>> {
  const ids = new Map<number, number>()
  const xs: number[] = []
  const ys: number[] = []
  const nodeOf = (x: number, y: number) => {
    const key = (Math.round(x) + 32_768) * 65_536 + (Math.round(y) + 32_768)
    let id = ids.get(key)
    if (id === undefined) {
      id = xs.length
      ids.set(key, id)
      xs.push(x)
      ys.push(y)
    }
    return id
  }
  const lineNodes = features.map((lines) =>
    lines.map((line) => {
      const nodes: number[] = []
      for (const point of line) {
        const id = nodeOf(point.x, point.y)
        if (nodes[nodes.length - 1] !== id) nodes.push(id)
      }
      return nodes
    }),
  )

  // Neighbours per node, as at most two ids plus a count past two.
  const count = xs.length
  const first = new Int32Array(count).fill(-1)
  const second = new Int32Array(count).fill(-1)
  const degree = new Uint16Array(count)
  const join = (a: number, b: number) => {
    if (degree[a] === 0) first[a] = b
    else if (degree[a] === 1) second[a] = b
    if (degree[a]! < 65_535) degree[a]! += 1
  }
  for (const lines of lineNodes) {
    for (const nodes of lines) {
      for (let index = 0; index + 1 < nodes.length; index += 1) {
        join(nodes[index]!, nodes[index + 1]!)
        join(nodes[index + 1]!, nodes[index]!)
      }
    }
  }

  let px = Float64Array.from(xs)
  let py = Float64Array.from(ys)
  for (let pass = 0; pass < passes; pass += 1) {
    const nx = px.slice()
    const ny = py.slice()
    for (let node = 0; node < count; node += 1) {
      if (degree[node] !== 2) continue
      const a = first[node]!
      const b = second[node]!
      if (a === b) continue
      nx[node] = px[node]! / 2 + (px[a]! + px[b]!) / 4
      ny[node] = py[node]! / 2 + (py[a]! + py[b]!) / 4
    }
    px = nx
    py = ny
  }

  return lineNodes.map((lines) =>
    lines
      .filter((nodes) => nodes.length >= 2)
      .map((nodes) => nodes.map((node) => ({ x: px[node]!, y: py[node]! }))),
  )
}

function readProperties(
  source: Record<string, boolean | number | string>,
  filter: ReadonlySet<string> | null,
): VectorTileProperties {
  if (!filter) return { ...source }
  const kept: VectorTileProperties = {}
  for (const key of filter) {
    const value = source[key]
    if (value !== undefined) kept[key] = value
  }
  return kept
}

/**
 * Whether the bytes carry a `layers` field, tile message field 3.
 *
 * This is the difference between "the archive has an empty tile here" and
 * "this is an HTML error page, a gzip blob, or a truncated read" -- and the
 * second must not draw as blank country over a basemap.
 */
function hasLayerField(bytes: Uint8Array): boolean {
  const found = { value: false }
  try {
    new PbfReader(bytes).readFields((tag, result: { value: boolean }) => {
      if (tag === 3) result.value = true
    }, found)
  } catch {
    return false
  }
  return found.value
}
