import { useLogger } from '#layer/server/utils/logger'
import { clearLayerUserSession, replaceLayerUserSession } from '#layer/server/utils/user-session'

import {
  getCurrentSessionUser,
  getCurrentSupabaseContext,
  loadAuthSessionRow,
  loadAuthUserRow,
  mergeAuthoritativeSessionUser,
} from '../lib/app-auth/session'

import {
  isRecoverableSupabaseSessionFailure,
  wasAuthSessionRecentlyValidated,
} from './auth-session-stability'

import type { AppSessionUser } from '../lib/app-auth/types'
import type { H3Event } from 'h3'

const inFlightSessionRefreshes = new Map<string, Promise<AppSessionUser>>()
const REFRESHED_SESSION_USER_KEY = '_nardukRefreshedSessionUser'

function isUnauthorizedError(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 401
  )
}

/**
 * The session-user fields the cookie surfaces to the client. A change to any of
 * them rewrites the cookie; before narduk-libs#1042 only the first five did, so
 * `needsPasswordSetup` and `authProviders` could stay stale until re-login.
 */
const SURFACED_SESSION_USER_FIELDS = [
  'email',
  'name',
  'isAdmin',
  'recoveryMode',
  'aal',
  'needsPasswordSetup',
  'authProvider',
  'authProviders',
  'emailConfirmedAt',
] as const satisfies ReadonlyArray<keyof AppSessionUser>

function sameSurfacedValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  return left === right
}

function surfacedSessionUserChanged(cookie: AppSessionUser, principal: AppSessionUser): boolean {
  return SURFACED_SESSION_USER_FIELDS.some(
    (field) => !sameSurfacedValue(cookie[field], principal[field]),
  )
}

async function refreshLocalSessionUser(
  event: H3Event,
  sessionUser: AppSessionUser,
  expiresAt: number,
  principal: AppSessionUser,
): Promise<AppSessionUser | null> {
  if (expiresAt <= Math.floor(Date.now() / 1000)) {
    await clearLayerUserSession(event)
    return null
  }
  if (surfacedSessionUserChanged(sessionUser, principal)) {
    await replaceLayerUserSession(event, { user: principal })
  }
  return principal
}

function getCoalescedSessionRefresh(event: H3Event, authSessionId: string) {
  const existingRefresh = inFlightSessionRefreshes.get(authSessionId)
  if (existingRefresh) {
    return {
      refreshPromise: existingRefresh,
      reused: true,
    }
  }

  const refreshPromise = getCurrentSupabaseContext(event)
    .then((context) => context.sessionUser)
    .finally(() => {
      if (inFlightSessionRefreshes.get(authSessionId) === refreshPromise) {
        inFlightSessionRefreshes.delete(authSessionId)
      }
    })

  inFlightSessionRefreshes.set(authSessionId, refreshPromise)
  return {
    refreshPromise,
    reused: false,
  }
}

async function refreshSessionUser(event: H3Event): Promise<AppSessionUser | null> {
  const sessionUser = await getCurrentSessionUser(event)
  if (!sessionUser) {
    return null
  }

  if (!sessionUser.authSessionId) {
    await clearLayerUserSession(event)
    return null
  }

  let authSession
  let dbUser
  try {
    authSession = await loadAuthSessionRow(event, sessionUser.authSessionId)
    if (authSession) {
      dbUser = await loadAuthUserRow(event, sessionUser.id)
    }
  } catch (error) {
    useLogger(event)
      .child('AppAuth')
      .warn('Auth session lookup failed; request is unauthenticated', { error })
    return null
  }

  if (!authSession) {
    await clearLayerUserSession(event)
    return null
  }

  if (!dbUser) {
    await clearLayerUserSession(event)
    return null
  }

  const principal = mergeAuthoritativeSessionUser(sessionUser, authSession, dbUser)

  if (sessionUser.authBackend === 'local') {
    return refreshLocalSessionUser(event, sessionUser, authSession.expiresAt, principal)
  }

  if (wasAuthSessionRecentlyValidated(sessionUser)) {
    return principal
  }

  let reusedRefresh = false
  try {
    const { refreshPromise, reused } = getCoalescedSessionRefresh(event, sessionUser.authSessionId)
    reusedRefresh = reused
    const refreshedUser = await refreshPromise

    if (reused) {
      await replaceLayerUserSession(event, { user: refreshedUser })
    }

    return refreshedUser
  } catch (error) {
    if (isUnauthorizedError(error)) {
      if (reusedRefresh) {
        await clearLayerUserSession(event)
      }
      return null
    }
    if (isRecoverableSupabaseSessionFailure(error)) {
      // Degrade to "token not refreshed this request", never to
      // "cookie is authoritative": the live users and auth_sessions rows
      // were already read above, so isAdmin/recoveryMode stay server-sourced.
      return principal
    }
    useLogger(event)
      .child('AppAuth')
      .warn('Auth session refresh failed; request is unauthenticated', { error })
    return null
  }
}

export async function useRefreshedSessionUser(event: H3Event): Promise<AppSessionUser | null> {
  const context = event.context as H3Event['context'] & {
    [REFRESHED_SESSION_USER_KEY]?: Promise<AppSessionUser | null>
  }
  const cached = context[REFRESHED_SESSION_USER_KEY]
  if (cached) {
    return cached
  }

  const pending = refreshSessionUser(event)
  context[REFRESHED_SESSION_USER_KEY] = pending
  return pending
}

export async function useRefreshedSessionUserResponse(event: H3Event) {
  const user = await useRefreshedSessionUser(event)
  return { user }
}

export function useCoalescedRefreshedSessionUser(event: H3Event) {
  return useRefreshedSessionUser(event)
}

export function useCoalescedRefreshedSessionUserResponse(event: H3Event) {
  return useRefreshedSessionUserResponse(event)
}
