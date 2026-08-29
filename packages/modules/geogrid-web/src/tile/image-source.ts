import type { GridStyle } from '../render/types.js'
import {
  GridTileRenderer,
  blankTileCanvas,
  renderGridTile,
  toGridTileLayer,
  type GridTileRenderOptions,
  type GridTileSource,
} from './baker.js'
import { tileIntersectsBBox, type GridTileKey } from './mercator.js'

/**
 * A host-agnostic tiled image source over a decoded grid.
 *
 * ## The contract, and why it is spelled out rather than imported
 *
 * The returned function is **structurally** the type narduk-mapkit's
 * `createMapKitAsyncTileOverlay` accepts (`MapKitTileOverlayImageSource`), and
 * that is deliberate: this package takes no dependency on narduk-mapkit, and
 * narduk-mapkit needs no dependency on this one. Neither is a plugin of the
 * other — a grid renderer and a map-host adapter simply agree on a function
 * shape. It is equally usable from MapLibre, Leaflet, or a bare `<canvas>`
 * loop that wants a tile.
 *
 * Three rules come from that seam, and getting any of them wrong fails quietly:
 *
 * 1. **Argument three is `z`, argument four is `scale`.** Verified empirically
 *    against real MapKit JS on 2026-07-08 by passing a labeled function and
 *    reading the values that actually arrived — the documented order is not the
 *    delivered one. Reading them the other way round hands every tile `z = 1`,
 *    which is very nearly the whole earth, so the layer renders *something* and
 *    nothing throws. (narduk-mapkit `src/client/runtime.ts:29-34` carries the
 *    same note beside its own type.)
 * 2. **The canvas is `side * scale` pixels.** `side` is the tile's point size,
 *    `scale` the device factor; a `@2x` tile is 512 pixels of the *same*
 *    geography.
 * 3. **`null` is not "nothing to draw".** The host reads the first non-null
 *    image as the layer becoming ready — narduk-mapkit turns it into
 *    `onFirstImage`, which `MapKitLayerRegistry` waits on before crossfading,
 *    and gives up after 1500 ms. A grid that covers one basin makes most of the
 *    world's tiles empty, so returning `null` for them would routinely leave a
 *    layer stuck behind that timeout. An empty tile is therefore a **fully
 *    transparent canvas**; `null` is reserved for "the grid for this tile could
 *    not be obtained".
 */

/** What the source is asked for. `side` is the **pixel** side, `scale` already applied. */
export interface GridTileRequest extends GridTileKey {
  /** The host's device scale factor, as delivered in argument four. */
  scale: number
  /** The overlay's `data` option, passed through untouched. */
  data?: unknown
}

/**
 * Resolve the grid for one tile. May be async.
 *
 * Resolving `null` yields a `null` tile — the one sanctioned way to say "no
 * grid here". A rejection propagates, so a host that wired up an error hook
 * (narduk-mapkit's `onError`) hears about a failed fetch instead of silently
 * showing gaps.
 */
export type GridTileSourceResolver = (
  request: GridTileRequest,
) => GridTileSource | null | Promise<GridTileSource | null>

export type GridTileStyleResolver = (request: GridTileRequest) => GridStyle

/**
 * The function shape a tiled host consumes.
 *
 * Structurally identical to narduk-mapkit's
 * `MapKitTileOverlayImageSource<OffscreenCanvas>`, by agreement rather than by
 * import.
 */
export type GridTileImageSource = (
  x: number,
  y: number,
  z: number,
  scale: number,
  data?: unknown,
) => Promise<OffscreenCanvas | null>

export interface CreateGridTileImageSourceOptions {
  /** A fixed grid, or a per-tile resolver for a grid that is fetched or swapped. */
  source: GridTileSource | GridTileSourceResolver
  /**
   * A fixed style, or a per-tile resolver.
   *
   * A resolver is **not** consulted for a culled tile — there is nothing to
   * color — so it observes a subset of the tiles the source resolver does. Keep
   * it a pure function of the request rather than a place to count tiles.
   */
  style: GridStyle | GridTileStyleResolver
  /** Tile side in points, before `scale`. Defaults to `256`. */
  side?: number
  /** Plane to render from a multi-plane dataset. Defaults to `0`. */
  planeIndex?: number
  /** Flat alpha multiplier. See {@link GridTileRenderOptions.opacity}. */
  opacity?: number
  /** Renderer to bake through. Defaults to the shared WebGL2 renderer. */
  renderer?: GridTileRenderer | null
  /** Force a backend. `auto` (default) prefers WebGL2. */
  backend?: 'auto' | 'webgl2' | 'cpu'
  /**
   * Skip the per-pixel pass for tiles whose extent cannot overlap the grid,
   * answering with a transparent canvas immediately. Defaults to `true`.
   *
   * Worth having on: a basin-sized grid is missed by all but a handful of the
   * world's tiles at any zoom, and this turns those from a full fragment pass
   * (or 65 536 CPU samples) into an allocation.
   */
  cullToBBox?: boolean
}

function positiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.max(1, Math.round(value))
}

/**
 * The largest tile this will bake, in pixels per side.
 *
 * `side * scale` is host-supplied on one half, and a finite-but-absurd scale is
 * not caught by the `Number.isFinite` guard: a `scale` of `1e5` asks for a
 * 25.6-megapixel tile and, on the CPU path, something like `6e14` samples. That
 * is indistinguishable from a hang. 8192 is comfortably past any real device
 * factor (a `@3x` 512-point tile is 1536) and fails loudly instead.
 */
const MAX_TILE_SIDE = 8192

/**
 * Build the tiled image source over a grid.
 *
 * ```ts
 * const imageForTile = createGridTileImageSource({
 *   source: dataset,
 *   style: { rampStops, valueRange: [0.01, 6.6], scale: 'log', sampling: 'coastal' },
 * })
 *
 * // narduk-mapkit, with no dependency in either direction:
 * createMapKitAsyncTileOverlay(mapkit, imageForTile, { opacity: 1 }, { onFirstImage })
 * ```
 *
 * Leave the host's own layer opacity at `1` when the style carries one — see
 * {@link GridTileRenderOptions.opacity} for why the two multiply.
 */
export function createGridTileImageSource(
  options: CreateGridTileImageSourceOptions,
): GridTileImageSource {
  const pointSide = positiveInteger(options.side ?? 256, 256)
  const cull = options.cullToBBox ?? true
  const resolveSource: GridTileSourceResolver =
    typeof options.source === 'function' ? options.source : () => options.source as GridTileSource
  const resolveStyle: GridTileStyleResolver =
    typeof options.style === 'function' ? options.style : () => options.style as GridStyle

  return async (x, y, z, scale, data) => {
    const deviceScale = Number.isFinite(scale) && scale > 0 ? scale : 1
    const side = positiveInteger(pointSide * deviceScale, pointSide)
    if (side > MAX_TILE_SIDE) {
      throw new RangeError(
        `tile side ${side}px (${pointSide} × scale ${deviceScale}) exceeds the ${MAX_TILE_SIDE}px cap`,
      )
    }
    const request: GridTileRequest = {
      z,
      x,
      y,
      side,
      scale: deviceScale,
      ...(data !== undefined ? { data } : {}),
    }

    const resolved = await resolveSource(request)
    if (!resolved) return null

    // Normalized once, then handed on: a decoded dataset's conversion hashes
    // its whole plane, and a layer passes straight through.
    const source = toGridTileLayer(resolved, options.planeIndex ?? 0)
    if (cull && !tileIntersectsBBox(request, source.bbox)) return blankTileCanvas(side)

    const style = resolveStyle(request)
    return renderGridTile(source, style, {
      z,
      x,
      y,
      side,
      ...(options.planeIndex !== undefined ? { planeIndex: options.planeIndex } : {}),
      ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
      ...(options.renderer !== undefined ? { renderer: options.renderer } : {}),
      ...(options.backend !== undefined ? { backend: options.backend } : {}),
    })
  }
}
