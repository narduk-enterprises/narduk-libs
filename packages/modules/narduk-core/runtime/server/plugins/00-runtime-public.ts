import { defineNitroPlugin } from 'nitropack/runtime'

import { applyRuntimePublicOverlay } from '../utils/runtime-public'

/**
 * Fill SSR `runtimeConfig.public` from live Worker bindings before Nuxt
 * serializes `__NUXT__`.
 *
 * Workers Builds does not inject `wrangler.json` `vars` into `nuxt build`.
 * Apps that write `process.env.GA_MEASUREMENT_ID || ''` therefore bake empty
 * strings, while `/api/runtime/public` still reads the short Worker names at
 * request time (buoys#133). Applying the same overlay here makes the HTML
 * payload match the Worker env without each app reading wrangler at build
 * time. Preview hosts still blank analytics via the overlay.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    applyRuntimePublicOverlay(event)
  })
})
