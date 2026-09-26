import { deleteAppCookie } from '@narduk-enterprises/narduk-app/server/http'
import { AuthSessionMissingError } from '@supabase/auth-js'
import { and, eq, inArray, lt, ne } from 'drizzle-orm'
import { createError } from 'h3'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import {
  clearLayerUserSession,
  getLayerUserSession,
  replaceLayerUserSession,
  setLayerUserSession,
} from '#layer/server/utils/user-session'
import { authSessions } from '#narduk-auth-server/app-orm-tables'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'
import {
  getSupabaseSessionErrorSummary,
  isRecoverableSupabaseSessionFailure,
  isRefreshTokenReuseFailure,
  isTerminalSupabaseSessionFailure,
  stampAuthSessionValidated,
} from '#narduk-auth-server/utils/auth-session-stability'
import { type User as LocalUser, users } from '#narduk-core/schema'

import { decodeAccessTokenPayload, extractProviderMetadata, toSessionUser } from './helpers'
import { ensureLinkedLocalUser } from './linking'
import { resolvePersistedRecoveryMode } from './recovery-mode'
import { createSupabaseUserClient } from './supabase-client'

import type {
  AppAuthenticatorAssuranceLevel,
  AppSessionUser,
  AppSupabaseContext,
  PersistedSupabaseSession,
} from './types'
import type {
  GoTrueClient,
  Session as SupabaseSession,
  User as SupabaseUser,
} from '@supabase/auth-js'
import type { H3Event } from 'h3'

export { resolvePersistedRecoveryMode } from './recovery-mode'

const PKCE_COOKIE_NAME = 'app_auth_pkce'
const AUTH_SESSION_ROTATION_RETRY_DELAYS_MS = [100, 250, 650] as const
const LOCAL_AUTH_SESSION_DAYS = 30
/** Bounded opportunistic purge of expired rows. Login only — never the request path. */
export const EXPIRED_AUTH_SESSION_SWEEP_LIMIT = 50
const AUTH_ROW_CACHE_KEY = '_nardukAuthRowCache'

function absoluteAuthSessionExpiry(nowSeconds = Math.floor(Date.now() / 1000)): number {
  return nowSeconds + LOCAL_AUTH_SESSION_DAYS * 86400
}

/**
 * Delete a capped batch of expired `auth_sessions` rows using
 * `auth_sessions_expires_at_idx`. Called from login inserts only.
 */
export async function sweepExpiredAuthSessions(event: H3Event): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const appDb = useAuthBridgeDatabase(event)
  await executeDatabaseQuery(
    appDb
      .delete(authSessions)
      .where(
        inArray(
          authSessions.id,
          appDb
            .select({ id: authSessions.id })
            .from(authSessions)
            .where(lt(authSessions.expiresAt, now))
            .limit(EXPIRED_AUTH_SESSION_SWEEP_LIMIT),
        ),
      ),
  )
}

type AuthSessionRow = typeof authSessions.$inferSelect
/** Per-request row reads, keyed `session:<id>` or `user:<id>`. */
type AuthRowCache = Map<string, Promise<unknown>>

interface SupabaseSetSessionResult {
  data: {
    session: SupabaseSession | null
    user: SupabaseUser | null
  } | null
  error: unknown
}

function toAppAuthenticatorAssuranceLevel(value: unknown): AppAuthenticatorAssuranceLevel | null {
  return value === 'aal1' || value === 'aal2' ? value : null
}

export async function persistSupabaseSession(
  event: H3Event,
  params: {
    authUser: SupabaseUser
    localUser: LocalUser
    recoveryMode?: boolean
    session: SupabaseSession
    sessionId?: string | null
  },
): Promise<PersistedSupabaseSession> {
  const appDb = useAuthBridgeDatabase(event)
  const now = new Date().toISOString()
  const payload = decodeAccessTokenPayload(params.session.access_token)
  const metadata = extractProviderMetadata(params.authUser)
  const authSessionId = params.sessionId ?? crypto.randomUUID()

  const existing =
    params.sessionId != null && params.sessionId !== ''
      ? await loadAuthSessionRow(event, params.sessionId)
      : null
  const recoveryMode = resolvePersistedRecoveryMode(params.recoveryMode, existing?.recoveryMode)

  const values = {
    localUserId: params.localUser.id,
    authUserId: params.authUser.id,
    sessionIdentifier:
      typeof payload.session_id === 'string' ? payload.session_id : params.session.user.id,
    accessToken: params.session.access_token,
    refreshToken: params.session.refresh_token,
    // Absolute row lifetime so abandoned Supabase sessions are sweepable.
    // Access-token TTL stays on the tokens; refresh updates this window.
    expiresAt: absoluteAuthSessionExpiry(),
    aal: toAppAuthenticatorAssuranceLevel(payload.aal),
    currentProvider: metadata.primaryProvider,
    providersJson: JSON.stringify(metadata.providers),
    recoveryMode,
    updatedAt: now,
  }

  if (params.sessionId) {
    await executeDatabaseQuery(
      appDb.update(authSessions).set(values).where(eq(authSessions.id, params.sessionId)),
    )
    forgetCachedAuthSessionRow(event, params.sessionId)
  } else {
    await sweepExpiredAuthSessions(event)
    await appDb.insert(authSessions).values({
      id: authSessionId,
      createdAt: now,
      ...values,
    })
  }

  return {
    authSessionId,
    aal: values.aal,
    providers: metadata.providers,
    authProvider: metadata.primaryProvider,
    emailConfirmedAt: metadata.emailConfirmedAt,
    needsPasswordSetup: metadata.needsPasswordSetup,
    recoveryMode: values.recoveryMode,
  }
}

export async function getCurrentSessionUser(event: H3Event): Promise<AppSessionUser | null> {
  const session = await getLayerUserSession(event)
  return session.user ? (session.user as AppSessionUser) : null
}

export async function setCurrentSessionUser(event: H3Event, user: AppSessionUser) {
  await setLayerUserSession(event, {
    user: {
      ...user,
      aal: toAppAuthenticatorAssuranceLevel(user.aal),
    },
  })
}

export async function clearCurrentSession(event: H3Event) {
  const sessionUser = await getCurrentSessionUser(event)
  const authSessionId = sessionUser?.authSessionId
  if (authSessionId) {
    const appDb = useAuthBridgeDatabase(event)
    await executeDatabaseQuery(appDb.delete(authSessions).where(eq(authSessions.id, authSessionId)))
  }

  deleteAppCookie(event, PKCE_COOKIE_NAME, { path: '/' })
  await clearLayerUserSession(event)
}

async function getAuthSessionById(
  appDb: ReturnType<typeof useAuthBridgeDatabase>,
  authSessionId: string,
): Promise<AuthSessionRow | null> {
  return (
    (await getDatabaseRow<AuthSessionRow>(
      appDb.select().from(authSessions).where(eq(authSessions.id, authSessionId)),
    )) ?? null
  )
}

function authRowCache(event: H3Event): AuthRowCache {
  const context = event.context as H3Event['context'] & {
    [AUTH_ROW_CACHE_KEY]?: AuthRowCache
  }
  return (context[AUTH_ROW_CACHE_KEY] ??= new Map())
}

function memoizeAuthRow<T>(event: H3Event, key: string, load: () => Promise<T>): Promise<T> {
  const cache = authRowCache(event)
  const existing = cache.get(key)
  if (existing) {
    return existing as Promise<T>
  }

  const pending = load()
  cache.set(key, pending)
  return pending
}

/**
 * Look up an `auth_sessions` row by id. Memoized on the event so requireAuth,
 * session refresh, and grant validation share one D1 read per session per request.
 */
// `async` keeps a throwing database accessor a rejected promise, not a
// synchronous throw; both loaders are auto-imported into apps.
export async function loadAuthSessionRow(
  event: H3Event,
  authSessionId: string,
): Promise<AuthSessionRow | null> {
  return memoizeAuthRow(event, `session:${authSessionId}`, () =>
    getAuthSessionById(useAuthBridgeDatabase(event), authSessionId),
  )
}

function forgetCachedAuthSessionRow(event: H3Event, authSessionId: string): void {
  authRowCache(event).delete(`session:${authSessionId}`)
}

/**
 * Current `users` row for authorization fields (`isAdmin`, email, name).
 * Memoized on the event so grant validation and session refresh share one read.
 */
export async function loadAuthUserRow(event: H3Event, userId: string): Promise<LocalUser | null> {
  return memoizeAuthRow(event, `user:${userId}`, () =>
    Promise.resolve(
      getDatabaseRow<LocalUser>(
        useDatabase(event).select().from(users).where(eq(users.id, userId)),
      ),
    ).then((row) => row ?? null),
  )
}

export function mergeAuthoritativeSessionUser(
  sessionUser: AppSessionUser,
  authSession: Pick<AuthSessionRow, 'aal' | 'recoveryMode'>,
  dbUser: LocalUser,
): AppSessionUser {
  return {
    ...sessionUser,
    email: dbUser.email,
    name: dbUser.name,
    isAdmin: dbUser.isAdmin,
    recoveryMode: Boolean(authSession.recoveryMode),
    aal: toAppAuthenticatorAssuranceLevel(authSession.aal) ?? sessionUser.aal ?? null,
  }
}

export async function clearAuthSessionRecoveryMode(
  event: H3Event,
  authSessionId: string | null | undefined,
): Promise<void> {
  if (!authSessionId) return
  await executeDatabaseQuery(
    useAuthBridgeDatabase(event)
      .update(authSessions)
      .set({ recoveryMode: false, updatedAt: new Date().toISOString() })
      .where(eq(authSessions.id, authSessionId)),
  )
  forgetCachedAuthSessionRow(event, authSessionId)
}

export async function persistLocalAuthSession(
  event: H3Event,
  localUser: LocalUser,
): Promise<{ authSessionId: string }> {
  const appDb = useAuthBridgeDatabase(event)
  const now = new Date().toISOString()
  const authSessionId = crypto.randomUUID()
  const token = `local-session:${crypto.randomUUID()}`

  await sweepExpiredAuthSessions(event)
  await appDb.insert(authSessions).values({
    id: authSessionId,
    localUserId: localUser.id,
    authUserId: localUser.id,
    sessionIdentifier: authSessionId,
    accessToken: token,
    refreshToken: token,
    expiresAt: absoluteAuthSessionExpiry(),
    aal: null,
    currentProvider: 'local',
    providersJson: '[]',
    recoveryMode: false,
    createdAt: now,
    updatedAt: now,
  })

  return { authSessionId }
}

export async function establishLocalSessionUser(
  event: H3Event,
  user: LocalUser,
  extras: Partial<AppSessionUser> = {},
): Promise<AppSessionUser> {
  const persisted = await persistLocalAuthSession(event, user)
  const sessionUser = stampAuthSessionValidated(
    toSessionUser(user, {
      authBackend: 'local',
      ...extras,
      authSessionId: persisted.authSessionId,
    }),
  )
  await setCurrentSessionUser(event, sessionUser)
  return sessionUser
}

/**
 * Delete `auth_sessions` rows for a local user. Pass `exceptSessionId` to leave
 * the caller's current web session alive (password change on this browser).
 */
export async function revokeUserAuthSessions(
  event: H3Event,
  userId: string,
  options: { exceptSessionId?: string | null } = {},
): Promise<void> {
  const appDb = useAuthBridgeDatabase(event)
  const exceptSessionId = options.exceptSessionId
  if (exceptSessionId) {
    await executeDatabaseQuery(
      appDb
        .delete(authSessions)
        .where(and(eq(authSessions.localUserId, userId), ne(authSessions.id, exceptSessionId))),
    )
    return
  }

  await executeDatabaseQuery(appDb.delete(authSessions).where(eq(authSessions.localUserId, userId)))
}

function authSessionRowChanged(
  previous: AuthSessionRow,
  next: AuthSessionRow | null,
): next is AuthSessionRow {
  return Boolean(
    next &&
    (next.accessToken !== previous.accessToken ||
      next.refreshToken !== previous.refreshToken ||
      next.expiresAt !== previous.expiresAt ||
      next.updatedAt !== previous.updatedAt),
  )
}

async function deleteUnchangedAuthSession(
  appDb: ReturnType<typeof useAuthBridgeDatabase>,
  authSession: AuthSessionRow,
): Promise<AuthSessionRow | null> {
  await executeDatabaseQuery(
    appDb
      .delete(authSessions)
      .where(
        and(
          eq(authSessions.id, authSession.id),
          eq(authSessions.accessToken, authSession.accessToken),
          eq(authSessions.refreshToken, authSession.refreshToken),
          eq(authSessions.updatedAt, authSession.updatedAt),
        ),
      ),
  )

  return getAuthSessionById(appDb, authSession.id)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollRotatedAuthSession(
  appDb: ReturnType<typeof useAuthBridgeDatabase>,
  authSession: AuthSessionRow,
  delayIndex: number,
): Promise<AuthSessionRow | null> {
  const delayMs = AUTH_SESSION_ROTATION_RETRY_DELAYS_MS[delayIndex]
  if (delayMs === undefined) {
    return null
  }

  await sleep(delayMs)
  const delayedAuthSession = await getAuthSessionById(appDb, authSession.id)
  if (authSessionRowChanged(authSession, delayedAuthSession)) {
    return delayedAuthSession
  }

  return pollRotatedAuthSession(appDb, authSession, delayIndex + 1)
}

async function waitForRotatedAuthSession(
  appDb: ReturnType<typeof useAuthBridgeDatabase>,
  authSession: AuthSessionRow,
  failure: unknown,
): Promise<AuthSessionRow | null> {
  const latestAuthSession = await getAuthSessionById(appDb, authSession.id)
  if (authSessionRowChanged(authSession, latestAuthSession)) {
    return latestAuthSession
  }

  if (!isRefreshTokenReuseFailure(failure)) {
    return null
  }

  return pollRotatedAuthSession(appDb, authSession, 0)
}

async function setSupabaseSession(
  client: GoTrueClient,
  authSession: AuthSessionRow,
): Promise<SupabaseSetSessionResult> {
  try {
    return await client.setSession({
      access_token: authSession.accessToken,
      refresh_token: authSession.refreshToken,
    })
  } catch (error) {
    return {
      data: { session: null, user: null },
      error,
    }
  }
}

function getSupabaseSetSessionFailure(result: SupabaseSetSessionResult): unknown | null {
  if (result.error) {
    return result.error
  }

  if (!result.data?.session || !result.data.user) {
    return new AuthSessionMissingError()
  }

  return null
}

function getRefreshLogData(authSessionId: string, error: unknown): Record<string, unknown> {
  const summary = getSupabaseSessionErrorSummary(error)
  return {
    authSessionId,
    errorCode: summary.code,
    errorMessage: summary.message,
    errorName: summary.name,
    status: summary.status,
  }
}

async function refreshSupabaseContextFromAuthSession(
  event: H3Event,
  appDb: ReturnType<typeof useAuthBridgeDatabase>,
  client: GoTrueClient,
  authSession: AuthSessionRow,
  allowRotationRetry: boolean,
): Promise<AppSupabaseContext> {
  const result = await setSupabaseSession(client, authSession)
  const failure = getSupabaseSetSessionFailure(result)

  if (failure) {
    const log = useLogger(event).child('AppAuth')

    if (isRecoverableSupabaseSessionFailure(failure)) {
      log.warn('Preserved auth session after retryable Supabase refresh failure', {
        ...getRefreshLogData(authSession.id, failure),
        outcome: 'preserved',
      })
      throw failure
    }

    if (isTerminalSupabaseSessionFailure(failure)) {
      if (allowRotationRetry) {
        const rotatedAuthSession = await waitForRotatedAuthSession(appDb, authSession, failure)
        if (rotatedAuthSession) {
          log.info('Retrying auth session refresh after concurrent rotation', {
            ...getRefreshLogData(authSession.id, failure),
            outcome: 'retried_after_rotation',
          })
          return refreshSupabaseContextFromAuthSession(
            event,
            appDb,
            client,
            rotatedAuthSession,
            false,
          )
        }
      }

      const remainingAuthSession = await deleteUnchangedAuthSession(appDb, authSession)
      if (authSessionRowChanged(authSession, remainingAuthSession)) {
        log.info('Retrying auth session refresh after concurrent terminal cleanup race', {
          ...getRefreshLogData(authSession.id, failure),
          outcome: 'retried_after_rotation',
        })
        return refreshSupabaseContextFromAuthSession(
          event,
          appDb,
          client,
          remainingAuthSession,
          false,
        )
      }

      await clearLayerUserSession(event)
      log.warn('Cleared auth session after confirmed terminal refresh failure', {
        ...getRefreshLogData(authSession.id, failure),
        outcome: 'cleared_terminal',
      })
      throw createError({
        statusCode: 401,
        statusMessage: 'Your auth session expired. Please sign in again.',
      })
    }

    throw failure
  }

  const session = result.data?.session
  const authUser = result.data?.user
  if (!session || !authUser) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Supabase returned an invalid auth refresh response.',
    })
  }

  const localUser = await ensureLinkedLocalUser(event, authUser)
  const persisted = await persistSupabaseSession(event, {
    authUser,
    localUser,
    session,
    sessionId: authSession.id,
    recoveryMode: authSession.recoveryMode,
  })

  const refreshedUser = stampAuthSessionValidated(
    toSessionUser(localUser, {
      authBackend: 'supabase',
      authSessionId: persisted.authSessionId,
      authProvider: persisted.authProvider,
      authProviders: persisted.providers,
      emailConfirmedAt: persisted.emailConfirmedAt,
      aal: persisted.aal,
      needsPasswordSetup: persisted.needsPasswordSetup,
      recoveryMode: persisted.recoveryMode,
    }),
  )
  await replaceLayerUserSession(event, { user: refreshedUser })

  return {
    client,
    localUser,
    authUser,
    session,
    sessionUser: refreshedUser,
    authSessionId: persisted.authSessionId,
  }
}

export async function getCurrentSupabaseContext(event: H3Event): Promise<AppSupabaseContext> {
  const sessionUser = await getCurrentSessionUser(event)
  if (!sessionUser?.authSessionId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'This account does not have an active shared auth session.',
    })
  }

  const appDb = useAuthBridgeDatabase(event)
  const authSession = await loadAuthSessionRow(event, sessionUser.authSessionId)

  if (!authSession) {
    await clearLayerUserSession(event)
    throw createError({
      statusCode: 401,
      statusMessage: 'Your auth session is no longer available. Please sign in again.',
    })
  }

  const client = createSupabaseUserClient(event)
  return refreshSupabaseContextFromAuthSession(event, appDb, client, authSession, true)
}

export async function commitSupabaseSessionFromClient(
  event: H3Event,
  params: {
    authSessionId: string
    authUser: SupabaseUser
    client: GoTrueClient
    localUser: LocalUser
    recoveryMode?: boolean
  },
) {
  const { data } = await params.client.getSession()
  if (!data.session) {
    return null
  }

  return persistSupabaseSession(event, {
    authUser: params.authUser,
    localUser: params.localUser,
    session: data.session,
    sessionId: params.authSessionId,
    recoveryMode: params.recoveryMode,
  })
}

export async function getSessionUserResponse(event: H3Event) {
  const user = await getCurrentSessionUser(event)
  if (!user?.authSessionId) {
    if (user) {
      await clearLayerUserSession(event)
    }
    return { user: null }
  }

  const authSession = await loadAuthSessionRow(event, user.authSessionId)
  if (!authSession) {
    await clearLayerUserSession(event)
    return { user: null }
  }

  const dbUser = await loadAuthUserRow(event, user.id)
  if (!dbUser) {
    await clearLayerUserSession(event)
    return { user: null }
  }

  const hydrated = mergeAuthoritativeSessionUser(user, authSession, dbUser)

  if (user.authBackend === 'local') {
    if (authSession.expiresAt <= Math.floor(Date.now() / 1000)) {
      await clearLayerUserSession(event)
      return { user: null }
    }
    return { user: hydrated }
  }

  try {
    const context = await getCurrentSupabaseContext(event)
    return { user: context.sessionUser }
  } catch (error) {
    if (isRecoverableSupabaseSessionFailure(error)) {
      return { user: hydrated }
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 401
    ) {
      return { user: null }
    }
    throw error
  }
}
