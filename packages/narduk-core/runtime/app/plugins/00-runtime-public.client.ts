import { defineNuxtPlugin, useRuntimeConfig } from '#imports'

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
