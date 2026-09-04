import { initializeMapKit } from '@narduk-enterprises/narduk-mapkit/client'
import { useRuntimeConfig } from '#imports'
import { readonly, ref } from 'vue'

const ready = ref(false)
const error = ref<string | null>(null)
let startPromise: Promise<unknown> | null = null

export function useMapKit() {
  if (import.meta.client && !startPromise) {
    const config = useRuntimeConfig()
    const staticToken = String(config.public.mapkitToken || '')
    const tokenEndpoint = String(config.public.mapkitTokenEndpoint || '/api/mapkit-token')

    startPromise = initializeMapKit({ staticToken, tokenEndpoint })
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
    void startPromise.catch(() => undefined)
  }

  return {
    mapkitError: readonly(error),
    mapkitReady: readonly(ready),
  }
}
