// MapLibre setup every Narduk Geo map needs once per page: the worker URL (bundlers that pre-bundle
// MapLibre break its relative worker lookup, so the app names it) and the `pmtiles://` protocol.
// MapLibre's functions are passed in, never imported here, so this entry never loads maplibre-gl.

import { Protocol } from 'pmtiles'

import type { addProtocol, setWorkerUrl } from 'maplibre-gl'

export interface MapLibreGlobals {
  addProtocol: typeof addProtocol
  setWorkerUrl?: typeof setWorkerUrl
}

const installed = new WeakSet<MapLibreGlobals['addProtocol']>()

/** Register `pmtiles://` with MapLibre. Idempotent per MapLibre module. */
export function registerPmtilesProtocol(maplibre: Pick<MapLibreGlobals, 'addProtocol'>): void {
  if (installed.has(maplibre.addProtocol)) return
  maplibre.addProtocol('pmtiles', new Protocol().tile)
  installed.add(maplibre.addProtocol)
}

/**
 * One-time MapLibre setup: name the worker (when given) and register `pmtiles://`.
 *
 * ```ts
 * import { addProtocol, setWorkerUrl } from 'maplibre-gl'
 * import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
 * setupMapLibre({ addProtocol, setWorkerUrl }, { workerUrl })
 * ```
 */
export function setupMapLibre(maplibre: MapLibreGlobals, options: { workerUrl?: string } = {}) {
  if (options.workerUrl && maplibre.setWorkerUrl) maplibre.setWorkerUrl(options.workerUrl)
  registerPmtilesProtocol(maplibre)
}
