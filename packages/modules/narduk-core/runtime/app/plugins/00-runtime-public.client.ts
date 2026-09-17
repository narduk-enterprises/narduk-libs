import { defineNuxtPlugin, useRuntimeConfig } from '#imports'

/**
 * Confirm the request-time overlay after hydration.
 *
 * SSR already applies `applyRuntimePublicOverlay` in the Nitro
 * `00-runtime-public` plugin so `__NUXT__` is not an empty bake. This fetch
 * keeps SPA navigations and a missed SSR apply on the same Worker bindings.
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
