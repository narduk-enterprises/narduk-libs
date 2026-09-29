import { defineNuxtPlugin, useRuntimeConfig, useUserSession, watch } from '#imports'

import { createAnalyticsIdentity } from '../utils/analyticsIdentity'

export default defineNuxtPlugin({
  name: 'analytics-identity',
  dependsOn: ['posthog'],
  setup(nuxtApp) {
    const transport = nuxtApp.$analytics
    if (!transport) return
    const config = useRuntimeConfig()
    const synchronize = createAnalyticsIdentity(
      transport,
      config.public.analyticsAppId || window.location.hostname,
    )
    const { user, ready } = useUserSession()
    const stop = watch(
      () => ({ ready: ready.value, id: (user.value as { id?: unknown } | null)?.id }),
      (session) => {
        if (session.ready) synchronize(session.id)
      },
      { immediate: true },
    )
    nuxtApp.vueApp.onUnmount(stop)
  },
})
