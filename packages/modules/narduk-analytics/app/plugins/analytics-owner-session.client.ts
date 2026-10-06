import { defineNuxtPlugin, useUserSession, watch } from '#imports'

import { setAuthenticatedOwnerSignal } from '../traffic/trafficClassBrowser'

/** How long classification waits for a session that is not ready yet. */
const SESSION_WAIT_MS = 3000

/**
 * Registered only when the app sets `nardukAnalytics.authenticatedOwner`: an
 * estate app on narduk-auth whose admins are the owner (the operator portal,
 * Harbor, estate products Logan administers). A signed-in session whose user
 * is an admin is tagged `traffic_class=owner`,
 * `traffic_evidence=authenticated_session`, with no enrollment. Other signed-in
 * users stay unmarked: they are real users. Never set it on a client site,
 * whose admins are the client. No identity goes onto the event.
 *
 * Registered before the PostHog and GA4 plugins, so the signal is in place
 * before either resolves the page's class.
 */
export default defineNuxtPlugin({
  name: 'analytics-owner-session',
  setup() {
    const { loggedIn, ready, user } = useUserSession()
    setAuthenticatedOwnerSignal(
      () =>
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), SESSION_WAIT_MS)
          const stop = watch(
            () => ready.value,
            (isReady) => {
              if (!isReady) return
              clearTimeout(timer)
              // Owner by role, never by "anyone signed in": other accounts on
              // an app are real users.
              resolve(
                loggedIn.value === true &&
                  (user.value as { isAdmin?: unknown } | null)?.isAdmin === true,
              )
              queueMicrotask(() => stop())
            },
            { immediate: true },
          )
        }),
    )
  },
})
