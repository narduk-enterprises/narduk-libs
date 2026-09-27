import { defineEventHandler } from 'h3'

import {
  getLayerUserSession,
  hasLayerUserSession,
  peekLayerUserSession,
} from '#layer/server/utils/user-session'
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

  // No session cookie, nothing to revalidate: a revoked cookie can only stop
  // authenticating if there is one (#442). Reading the session anyway went
  // through h3's `useSession`, which seals and sets a new 30-day cookie on
  // every anonymous page and 404 (narduk-libs#1214).
  if (!hasLayerUserSession(event)) {
    // nuxt-auth-utils' own read does the same when it reaches `useSession`,
    // and the client calls it on load (cached and prerendered pages, the
    // `client-only` load strategy). Answer it as signed out here instead.
    return isNuxtAuthUtilsSessionRead(event) ? {} : undefined
  }

  let refreshed: Awaited<ReturnType<typeof useRefreshedSessionUser>> = null
  try {
    refreshed = await useRefreshedSessionUser(event)
  } catch {
    // A thrown lookup must not 500 the page. The grant validator fails
    // the request closed without clearing the cookie.
  }

  if (refreshed) {
    return
  }

  const cookieSession = await peekLayerUserSession(event)
  if (!cookieSession) {
    // The request carries a session that does not unseal: tampered, sealed
    // with a rotated password, or older than `maxAge`. Replace it with a
    // fresh empty session, which is what h3's `useSession` does, so that
    // every later read in this request sees signed out, nuxt-auth-utils'
    // `getUserSession` included, whatever config it reads with. The
    // side-effect-free peek would otherwise leave nuxt-auth-utils to unseal
    // the request's cookie on its own (narduk-libs#1214). A request that
    // carried no session never reaches this point, so it still gets no cookie.
    await getLayerUserSession(event)
  }

  // nuxt-auth-utils answers this route from the sealed cookie and never asks
  // the grant validator; clearing the session does not stop it either, since
  // h3 re-reads the request's cookie. So a cookie that is unreadable, or
  // still carries a user whose grant is revoked, expired or unreadable, is
  // answered here, as signed out (narduk-libs#1041, #1214). A live session, a
  // readable cookie with no user, and the DELETE sign-out stay with
  // nuxt-auth-utils.
  if (isNuxtAuthUtilsSessionRead(event) && (!cookieSession || cookieSession.user)) {
    return {}
  }
})
