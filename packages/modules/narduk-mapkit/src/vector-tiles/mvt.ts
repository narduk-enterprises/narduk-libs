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
   * Worth setting on a dense archive: properties are the only part of a
   * decoded tile that is not a flat buffer, so a `name` string on each of a
   * few thousand reaches per tile is what actually grows the cache.
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
  // one rather than the first, so the rescale only ever adds precision.
  let extent = 0
  for (const name of names) {
    const layer = tile.layers[name]
    if (layer) extent = Math.max(extent, layer.extent)
  }
  if (extent <= 0) return null

  const features: VectorTileFeatureInput[] = []
  for (const name of names) {
    const layer = tile.layers[name]
    if (!layer) continue
    const scale = extent / layer.extent
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index)
      const lines = feature.loadGeometry()
      if (lines.length === 0) continue
      features.push({
        lines:
          scale === 1
            ? lines
            : lines.map((line) =>
                line.map((point) => ({ x: point.x * scale, y: point.y * scale })),
              ),
        properties: readProperties(feature.properties, propertyFilter),
      })
    }
  }

  if (features.length === 0) return null
  return buildDecodedVectorTile(extent, features)
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
