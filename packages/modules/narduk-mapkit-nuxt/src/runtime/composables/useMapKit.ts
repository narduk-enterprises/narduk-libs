import { initializeMapKit } from '@narduk-enterprises/narduk-mapkit/client'
import { useRuntimeConfig } from '#imports'
import { readonly, ref } from 'vue'

const ready = ref(false)
const error = ref<string | null>(null)
let startPromise: Promise<unknown> | null = null

export function useMapKit() {
  if (import.meta.client && !startPromise) {
    const config = useRuntimeConfig()
    const tokenEndpoint = String(config.public.mapkitTokenEndpoint || '/api/mapkit-token')
    // `libraries` is mandatory in MapKit JS 6 and `staticToken` is gone
    // (narduk-libs#421 §d). S5 owns exposing the library list as module
    // configuration; this is the set the adapter's own components need.
    const libraries = ['map', 'annotations', 'overlays']

    startPromise = initializeMapKit({ libraries, tokenEndpoint })
      .then((mapkit) => {
        ready.value = true
        error.value = null
        document.documentElement.dataset.mapkitLoaded = 'true'
        return mapkit
      })
      .catch((cause: unknown) => {
        error.value = cause instanceof Error ? cause.message : 'MapKit JS initialization failed'
        startPromise = null
        throw cause
      })
    // Runtime expression left exactly as written upstream.
    // eslint-disable-next-line unicorn/no-useless-undefined -- narduk-libs#138
    void startPromise.catch(() => undefined)
  }

  return {
    mapkitError: readonly(error),
    mapkitReady: readonly(ready),
  }
}
