import { defineNuxtPlugin, useRuntimeConfig } from '#imports'

/**
 * Apply the full request-time overlay in the browser.
 *
 * SSR already writes the browser-only keys (analytics, SEO meta, geolocation)
 * in the Nitro `00-runtime-public` plugin, so `__NUXT__` is not an empty bake.
 * This fetch applies the rest of the overlay (deployment target, preview-safe
 * mode, auth) and covers prerendered or cached HTML that never went through it.
 */
export default defineNuxtPlugin({
  name: 'runtime-public',
  async setup() {
    const runtimeConfig = useRuntimeConfig()
    const runtimePublic = await $fetch<Record<string, unknown>>('/api/runtime/public').catch(
      () => null,
    )

    if (!runtimePublic) return

    Object.assign(runtimeConfig.public, runtimePublic)
  },
})
