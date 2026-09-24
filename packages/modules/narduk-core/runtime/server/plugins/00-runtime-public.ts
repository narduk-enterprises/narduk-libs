import { defineNitroPlugin } from 'nitropack/runtime'

import { applyRuntimePublicOverlay } from '../utils/runtime-public'

/**
 * Paths that never render a Nuxt page, so they skip the overlay's ~40 env
 * reads. `/__nuxt_error` is not here: the error page is an SSR render with its
 * own `__NUXT__` payload.
 */
const NON_RENDER_PATH_PREFIXES = ['/api/', '/_nuxt/'] as const

function shouldApplyRuntimePublicOverlay(path: string | undefined): boolean {
  if (!path) return true
  return !NON_RENDER_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/**
 * Fill SSR `runtimeConfig.public` from live Worker bindings before Nuxt
 * serializes `__NUXT__`.
 *
 * Workers Builds does not inject `wrangler.json` `vars` into `nuxt build`.
 * Apps that write `process.env.GA_MEASUREMENT_ID || ''` therefore bake empty
 * strings, while `/api/runtime/public` still reads the short Worker names at
 * request time (buoys#133). Applying the browser-only part of the same overlay
 * here makes the HTML payload match the Worker env without each app reading
 * wrangler at build time. Preview hosts still blank analytics via the overlay.
 * See `RUNTIME_PUBLIC_SSR_KEYS` for which keys are written and why the rest
 * are not.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (!shouldApplyRuntimePublicOverlay(event.path)) return
    applyRuntimePublicOverlay(event)
  })
})
