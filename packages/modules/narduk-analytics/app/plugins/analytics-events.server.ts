import { defineNuxtPlugin } from '#imports'

/** Vue's SSR compiler resolves custom directives even when their effects are client-only. */
export default defineNuxtPlugin({
  name: 'analytics-events-ssr',
  setup(nuxtApp) {
    nuxtApp.vueApp.directive('track', {})
  },
})
