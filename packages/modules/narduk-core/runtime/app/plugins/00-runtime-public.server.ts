import { defineNuxtPlugin, useRequestEvent } from '#imports'

/**
 * Hand the request's full public overlay to the browser in the SSR payload.
 *
 * The Nitro `00-runtime-public` plugin resolves the overlay once per page
 * request and leaves it on `event.context.runtimePublicOverlay`. Embedding it
 * lets the browser plugin apply it before hydration without a fetch
 * (narduk-libs#1368). It is the same object `GET /api/runtime/public` returns,
 * so it carries nothing that endpoint does not already publish.
 *
 * Prerendered pages are skipped: their overlay would be the build's, and the
 * browser must fetch the Worker's.
 */
export default defineNuxtPlugin({
  name: 'runtime-public-payload',
  setup(nuxtApp) {
    if (import.meta.prerender) return

    const context = useRequestEvent()?.context as
      { runtimePublicOverlay?: Record<string, unknown> } | undefined
    const values = context?.runtimePublicOverlay
    if (!values) return

    // Key shared with `readEmbeddedRuntimePublic` (a relative parent import is
    // not allowed in a `.server` file); the test pins the two together.
    nuxtApp.payload.runtimePublic = { at: Date.now(), values }
  },
})
