/**
 * `useMapKit()` -- one MapKit JS initialization per page, shared by every map.
 *
 * ## What changed from the 2.0.x adapter
 *
 * - `libraries` is real configuration instead of a hard-coded
 *   `['map', 'annotations', 'overlays']`. MapKit JS 6 loads nothing by default,
 *   so the list decides what the page downloads; an app that draws only pins
 *   should not be paying for `overlays`.
 * - The failure is a structured `MapKitFailure`, not a string. `#error` renders
 *   the code and Apple's `originMismatch` diagnostic, which is the single most
 *   useful string for a misconfigured preview host.
 * - `retry()` exists. MapKit never re-asks for a token after a rejection --
 *   measured 2026-09-17: three `/ma/bootstrap` attempts with the SAME token,
 *   one `authorizationCallback`, then `Unauthorized`. Recovery is ours.
 */
import { readonly, ref, shallowRef } from 'vue'

import { initializeMapKit } from '../../../client/mapkit.js'
import { resolveMapKitRuntimeOptions } from '../options.js'

import type { MapKitFailure, MapKitLibrary } from '../../../client/mapkit.js'
import type { MapKit } from '@apple/mapkit-loader'
import type { DeepReadonly, Ref, ShallowRef } from 'vue'

export interface UseMapKitOptions {
  language?: string
  /** Overrides the module's `libraries` default for this page. */
  libraries?: readonly MapKitLibrary[]
  tokenEndpoint?: string
}

export interface UseMapKitResult {
  failure: Readonly<Ref<MapKitFailure | null>>
  /** The live namespace once `ready` is true. */
  mapkit: Readonly<ShallowRef<MapKit | null>>
  ready: DeepReadonly<Ref<boolean>>
  /** Drop the failed singleton and initialise again. */
  retry: () => void
}

const failure = ref<MapKitFailure | null>(null)
const namespace = shallowRef<MapKit | null>(null)
const ready = ref(false)
let pending: Promise<MapKit> | null = null

/** Test seam: the singleton is module state, so a suite has to be able to clear it. */
export function resetMapKitComposableStateForTests(): void {
  failure.value = null
  namespace.value = null
  ready.value = false
  pending = null
}

function start(options: UseMapKitOptions): void {
  if (pending) return
  const resolved = resolveMapKitRuntimeOptions(options)
  failure.value = null

  pending = initializeMapKit({
    libraries: resolved.libraries,
    tokenEndpoint: resolved.tokenEndpoint,
    ...(resolved.language === undefined ? {} : { language: resolved.language }),
    onFailure: (next) => {
      failure.value = next
    },
  })

  void pending.then(
    (loaded) => {
      namespace.value = loaded
      ready.value = true
      failure.value = null
    },
    (cause: unknown) => {
      // `initializeMapKit` already reported the structured failure through
      // `onFailure`; this only makes the next call able to try again.
      pending = null
      ready.value = false
      failure.value ??= {
        message: cause instanceof Error ? cause.message : String(cause),
        source: 'mapkit',
        status: 'Unknown',
      }
    },
  )
}

export function useMapKit(options: UseMapKitOptions = {}): UseMapKitResult {
  // Nothing loads MapKit during SSR: `renderHTMLAttributes()` (emitted by the
  // module without a token) is the only thing that reaches the server.
  if (typeof window !== 'undefined') start(options)

  return {
    failure: readonly(failure) as Readonly<Ref<MapKitFailure | null>>,
    mapkit: readonly(namespace) as Readonly<ShallowRef<MapKit | null>>,
    ready: readonly(ready),
    retry: () => {
      pending = null
      ready.value = false
      namespace.value = null
      start(options)
    },
  }
}
