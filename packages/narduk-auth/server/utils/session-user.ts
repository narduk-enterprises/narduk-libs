import { clearLayerUserSession, replaceLayerUserSession } from '#layer/server/utils/user-session'

import { getCurrentSessionUser, getCurrentSupabaseContext } from './app-auth'
import {
  isRecoverableSupabaseSessionFailure,
  wasAuthSessionRecentlyValidated,
} from './auth-session-stability'

import type { AppSessionUser } from './app-auth'
import type { H3Event } from 'h3'

const inFlightSessionRefreshes = new Map<string, Promise<AppSessionUser>>()

function isUnauthorizedError(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 401
  )
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

export async function useRefreshedSessionUser(event: H3Event): Promise<AppSessionUser | null> {
  const sessionUser = await getCurrentSessionUser(event)
  if (!sessionUser?.authSessionId) {
    return sessionUser
  }

  if (wasAuthSessionRecentlyValidated(sessionUser)) {
    return sessionUser
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
      return sessionUser
    }
    throw error
  }
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
