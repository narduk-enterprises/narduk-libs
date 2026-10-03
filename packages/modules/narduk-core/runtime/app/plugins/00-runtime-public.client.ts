import { defineNuxtPlugin, useRuntimeConfig } from '#imports'

import {
  isRuntimePublicStale,
  readEmbeddedRuntimePublic,
} from '../../shared/runtime-public-payload'

type Overlay = Record<string, unknown>

function fetchOverlay(): Promise<Overlay | null> {
  return $fetch<Overlay>('/api/runtime/public').catch(() => null)
}

/**
 * Apply the full request-time overlay in the browser, before any other plugin
 * or component reads `runtimeConfig.public`.
 *
 * A live SSR response embeds the overlay it resolved in the payload (the
 * server `runtime-public-payload` plugin), so the common path applies it
 * synchronously and hydration never waits on a Worker round trip
 * (narduk-libs#1368). Plugins that `dependsOn: ['runtime-public']` still run
 * after it, and still see every key.
 *
 * Only HTML without a trustworthy embedded overlay (prerendered pages, or a
 * server that predates the payload plugin) fetches `/api/runtime/public` and
 * waits for it, as this plugin always did. Embedded values older than a minute
 * (cached HTML) are applied at once and then refreshed in the background.
 */
export default defineNuxtPlugin({
  name: 'runtime-public',
  setup(nuxtApp) {
    const runtimeConfig = useRuntimeConfig()
    const fetchAndApply = async () => {
      const overlay = await fetchOverlay()
      if (overlay) Object.assign(runtimeConfig.public, overlay)
    }

    const embedded = readEmbeddedRuntimePublic(nuxtApp.payload)
    if (!embedded) return fetchAndApply()

    Object.assign(runtimeConfig.public, embedded.values)
    if (isRuntimePublicStale(embedded.at, Date.now())) void fetchAndApply()
  },
})
