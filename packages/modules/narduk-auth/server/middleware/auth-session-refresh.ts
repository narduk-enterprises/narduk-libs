import { defineEventHandler } from 'h3'

import { getCurrentSessionUser } from '#narduk-auth-server/lib/app-auth/session'
import { shouldRevalidateAuthSession } from '#narduk-auth-server/utils/auth-session-refresh-path'
import { useRefreshedSessionUser } from '#narduk-auth-server/utils/session-user'

import type { H3Event } from 'h3'

/** nuxt-auth-utils' own session read, which the client's `useUserSession().fetch` calls. */
const NUXT_AUTH_UTILS_SESSION_PATH = '/api/_auth/session'

function isNuxtAuthUtilsSessionRead(event: H3Event): boolean {
  // Nitro's router ignores a trailing slash, so `/api/_auth/session/` reaches
  // the same nuxt-auth-utils handler and must be answered here too.
  const pathname = (event.path.split('?')[0] ?? event.path).replace(/\/+$/u, '')
  return pathname === NUXT_AUTH_UTILS_SESSION_PATH && event.method === 'GET'
}

export default defineEventHandler(async (event) => {
  if (!shouldRevalidateAuthSession(event.path)) {
    return
  }

  let refreshed: Awaited<ReturnType<typeof useRefreshedSessionUser>> = null
  try {
    refreshed = await useRefreshedSessionUser(event)
  } catch {
    // A thrown lookup must not 500 the page. The grant validator fails
    // the request closed without clearing the cookie.
  }

  // nuxt-auth-utils answers this route from the sealed cookie and never asks
  // the grant validator; clearing the session does not stop it either, since
  // h3 re-reads the request's cookie. So a cookie that still carries a user
  // whose grant is revoked, expired or unreadable is answered here, as signed
  // out (narduk-libs#1041). A live session, a cookie with no user, and the
  // DELETE sign-out stay with nuxt-auth-utils.
  if (!refreshed && isNuxtAuthUtilsSessionRead(event) && (await getCurrentSessionUser(event))) {
    return {}
  }
})
