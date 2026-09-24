import {
  createPmTilesFetchSource,
  createPmTilesTileSource,
  createVectorTileOverlaySource,
  createWorkerDecoder,
} from '@narduk-enterprises/narduk-mapkit/client'
import { onScopeDispose, shallowRef, toValue, watch } from 'vue'

import type {
  PmTilesReader,
  PmTilesSource,
  VectorTileDecoder,
  VectorTileHit,
  VectorTileHitTestOptions,
  VectorTileStyleFunction,
} from '@narduk-enterprises/narduk-mapkit/client'
import type { MaybeRefOrGetter, ShallowRef } from 'vue'

export interface UseMapKitVectorTilesOptions {
  /** Decoded-tile cache size, in tiles. */
  cacheSize?: number
  /**
   * How tile bytes become geometry. Supply this or `worker`, never both: the
   * decoder pulls in a protobuf parser, and running it on the main thread is
   * a choice an app should have to make on purpose.
   */
  decode?: VectorTileDecoder
  /** Extra headers on every range request, for example an auth header. */
  headers?: Record<string, string>
  onError?: (reason: unknown) => void
  /**
   * Wraps the range-request source as an archive reader — in an app,
   * `(source) => new PMTiles(source)`. The `pmtiles` package stays a
   * dependency of the app that already ships it rather than of this module.
   */
  reader: (source: PmTilesSource) => PmTilesReader
  /** Restyling repaints from the decoded cache without refetching. */
  style: MaybeRefOrGetter<VectorTileStyleFunction>
  tileSize?: number
  /** PMTiles archive. Changing it swaps the archive and drops the cache. */
  url: MaybeRefOrGetter<string | null | undefined>
  /**
   * A worker hosting `serveVectorTileDecoder`. The app constructs it, because
   * a published worker chunk is the one thing Vite, webpack and Nuxt do not
   * agree on. Disposed with the scope.
   */
  worker?: () => Worker
}

export interface UseMapKitVectorTiles {
  /** Retained decoded bytes, for sizing `cacheSize` against a budget. */
  readonly cacheBytes: Readonly<ShallowRef<number>>
  /** Drop every decoded tile. Called for you when the archive changes. */
  clearCache: () => void
  /** What is under a tap, from tiles already decoded. Never fetches. */
  hitTest: (options: VectorTileHitTestOptions) => VectorTileHit | null
  /** Pass to `createMapKitAsyncTileOverlay`; `null` until an archive is set. */
  imageForTile: (
    x: number,
    y: number,
    z: number,
    scale: number,
  ) => Promise<HTMLCanvasElement | null>
}

/**
 * A vector tile overlay source, wired to a Vue scope.
 *
 * The parts an app would otherwise repeat: build the PMTiles reader and the
 * overlay source, keep the decoder worker alive exactly as long as the scope,
 * rebuild when the archive changes, and restyle in place rather than
 * refetching. Everything it does is available directly from
 * `@narduk-enterprises/narduk-mapkit/client`; this is the Nuxt-shaped seam.
 *
 * `hitTest` is synchronous and cache-only, so it can answer during a tap.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const tiles = useMapKitVectorTiles({
 *   reader: (source) => new PMTiles(source),
 *   style: (properties) => ({ color: '#2563eb', width: Number(properties.so) > 5 ? 2 : 1 }),
 *   url: '/tiles/rivers.pmtiles',
 *   worker: () => new Worker(new URL('~/workers/tiles.ts', import.meta.url), { type: 'module' }),
 * })
 *
 * function onMapTap(coordinate: { latitude: number; longitude: number }, zoom: number) {
 *   const hit = tiles.hitTest({ coordinate, zoom })
 *   if (hit) selected.value = String(hit.properties.name ?? '')
 * }
 * </script>
 * ```
 */
export function useMapKitVectorTiles(options: UseMapKitVectorTilesOptions): UseMapKitVectorTiles {
  const { cacheSize, decode, headers, onError, reader, tileSize, worker } = options
  if (decode && worker) {
    throw new Error('useMapKitVectorTiles() takes decode or worker, not both.')
  }
  if (!decode && !worker) {
    throw new Error('useMapKitVectorTiles() needs a decode function or a worker.')
  }

  const cacheBytes = shallowRef(0)
  // Rebuilt whenever the archive changes; `null` while there is no archive.
  const source = shallowRef<ReturnType<
    typeof createVectorTileOverlaySource<HTMLCanvasElement>
  > | null>(null)

  let workerInstance: Worker | null = null
  let workerDecoder: ReturnType<typeof createWorkerDecoder> | null = null

  function decoder(): VectorTileDecoder {
    if (decode) return decode
    workerInstance ??= (worker as () => Worker)()
    workerDecoder ??= createWorkerDecoder({ worker: workerInstance })
    return workerDecoder.decode
  }

  function build(url: string | null | undefined) {
    source.value?.clearCache()
    cacheBytes.value = 0
    if (!url) {
      source.value = null
      return
    }
    const tiles = createPmTilesTileSource({
      reader: reader(createPmTilesFetchSource({ url, ...(headers ? { headers } : {}) })),
      ...(onError ? { onError } : {}),
    })
    source.value = createVectorTileOverlaySource<HTMLCanvasElement>({
      createCanvas: (width, height) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        return canvas
      },
      decode: decoder(),
      style: toValue(options.style),
      tileBytes: (z, x, y, signal) => tiles.getTile(z, x, y, signal),
      ...(cacheSize === undefined ? {} : { cacheSize }),
      ...(onError ? { onError } : {}),
      ...(tileSize === undefined ? {} : { tileSize }),
    })
  }

  watch(() => toValue(options.url), build, { immediate: true })
  // A lens change must not refetch: the decoded tiles are still correct, only
  // their paint is stale, which is the whole point of caching them decoded.
  watch(
    () => toValue(options.style),
    (style) => source.value?.setStyle(style),
  )

  // `failSilently`, rather than a conditional call: a composable used outside
  // a scope should not warn, and a hook behind an `if` is the thing that makes
  // a composable's cleanup depend on where it was called from.
  onScopeDispose(() => {
    source.value?.clearCache()
    source.value = null
    workerDecoder?.dispose()
    workerInstance?.terminate()
    workerDecoder = null
    workerInstance = null
  }, true)

  return {
    // The same ref, handed out read-only: a caller that writes it would be
    // lying about what the cache holds.
    cacheBytes: cacheBytes as Readonly<ShallowRef<number>>,
    clearCache() {
      source.value?.clearCache()
      cacheBytes.value = 0
    },
    hitTest(hitOptions) {
      return source.value?.hitTest(hitOptions) ?? null
    },
    async imageForTile(x, y, z, scale) {
      const active = source.value
      if (!active) return null
      const canvas = await active.imageForTile(x, y, z, scale)
      cacheBytes.value = active.cacheBytes
      return canvas
    },
  }
}
