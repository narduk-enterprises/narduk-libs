import { defineNuxtPlugin } from '#imports'

import { installAnalyticsDirective } from '../utils/analyticsDirective'

/** Optional plugin keeps event validation out of existing apps' startup bundles. */
export default defineNuxtPlugin({
  name: 'analytics-events',
  dependsOn: ['posthog'],
  setup(nuxtApp) {
    if (nuxtApp.$analytics) installAnalyticsDirective(nuxtApp.vueApp, nuxtApp.$analytics)
  },
})
