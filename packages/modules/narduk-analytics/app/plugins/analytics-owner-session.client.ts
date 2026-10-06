import { defineNuxtPlugin, useUserSession, watch } from '#imports'

import { setAuthenticatedOwnerSignal } from '../traffic/trafficClassBrowser'

/** How long classification waits for a session that is not ready yet. */
const SESSION_WAIT_MS = 3000

/**
 * Registered only when the app sets `nardukAnalytics.authenticatedOwner`: an
 * app behind narduk-auth whose every account is the owner (the operator
 * portal). A signed-in session there is owner traffic by construction, so it
 * is tagged `traffic_class=owner`, `traffic_evidence=authenticated_session`
 * with no enrollment. Never set it on an app with public accounts.
 *
 * Registered before the PostHog and GA4 plugins, so the signal is in place
 * before either resolves the page's class.
 */
export default defineNuxtPlugin({
  name: 'analytics-owner-session',
  setup() {
    const { loggedIn, ready } = useUserSession()
    setAuthenticatedOwnerSignal(
      () =>
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), SESSION_WAIT_MS)
          const stop = watch(
            () => ready.value,
            (isReady) => {
              if (!isReady) return
              clearTimeout(timer)
              resolve(loggedIn.value === true)
              queueMicrotask(() => stop())
            },
            { immediate: true },
          )
        }),
    )
  },
})
