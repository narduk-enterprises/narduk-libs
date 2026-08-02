import { and, eq, gt } from 'drizzle-orm'
import { createError, deleteCookie, getCookie, getRequestHeader, setCookie } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { apiKeys, sessions, users } from '#narduk-core/schema'

import {
  API_KEY_PREFIX,
  getApiKeyFromAuthorization,
  hashApiKeyText,
  hasRequiredApiKeyScopes,
  normalizeApiKeyAuthScopes as normalizeAuthScopes,
  nowSec,
  parseApiKeyScopeText as parseApiKeyScopes,
  resolveApiKeyExpirySeconds as resolveApiKeyExpiry,
  serializeApiKeyScopeText as serializeApiKeyScopes,
} from './authApiKeyText'
import { executeDatabaseQuery, getDatabaseRow, getDatabaseRows, useDatabase } from './database'
import { getLayerUserSession } from './user-session'

import type { User } from '#narduk-core/schema'
import type { H3Event } from 'h3'

/**
 * Session & authentication utilities.
 *
 * Primary session: nuxt-auth-utils (sealed cookie). requireAuth / requireAdmin
 * use that by default, but an explicit API key bearer header takes precedence.
 *
 * Optional D1 session helpers (createSession, getSessionUser, destroySession) are
 * for apps that want server-side session listing/revocation in addition to sealed cookies.
 *
 * API key auth (Authorization: Bearer nk_...) remains D1-backed for CLI/machine use.
 */

const DEFAULT_SESSION_COOKIE = 'app_session'
const SESSION_DAYS = 30

export const AUTH_API_KEY_SCOPES = {
  read: 'auth:api-keys:read',
  write: 'auth:api-keys:write',
} as const

export type AuthMethod = 'session' | 'api-key'
export type AuthScope = string

/** User shape returned by requireAuth (session or API key). */
export interface AuthUser {
  authMethod: AuthMethod
  email: string
  id: string
  isAdmin: boolean | null
  name: string | null
  scopes: AuthScope[]
}

interface AuthenticatedApiKey {
  apiKey: typeof apiKeys.$inferSelect
  scopes: AuthScope[]
  user: User
}

function getSessionCookieName(event: H3Event): string {
  try {
    const config = useRuntimeConfig(event)
    return (
      ((config as Record<string, unknown>).sessionCookieName as string) || DEFAULT_SESSION_COOKIE
    )
  } catch (err) {
    useLogger(event)
      .child('Auth')
      .warn('Failed to read sessionCookieName from runtimeConfig', { error: String(err) })
    return DEFAULT_SESSION_COOKIE
  }
}

export { normalizeAuthScopes, parseApiKeyScopes, resolveApiKeyExpiry, serializeApiKeyScopes }

export function requireAuthScopes(user: AuthUser, requiredScopes: readonly string[] = []): void {
  const normalizedRequired = normalizeAuthScopes(requiredScopes)
  if (normalizedRequired.length === 0 || user.authMethod !== 'api-key') {
    return
  }

  if (hasRequiredApiKeyScopes(user.scopes, normalizedRequired)) {
    return
  }

  throw createError({
    statusCode: 403,
    message: `Forbidden — missing required API key scopes: ${normalizedRequired.join(', ')}`,
  })
}

/**
 * Create a D1-backed session for a user and set the session cookie.
 * @optional Use when you need server-side session listing/revocation alongside nuxt-auth-utils.
 */
export async function createSession(event: H3Event, userId: string): Promise<string> {
  const db = useDatabase(event)
  const id = crypto.randomUUID()
  const expiresAt = nowSec() + SESSION_DAYS * 86400

  await db.insert(sessions).values({
    id,
    userId,
    expiresAt,
    createdAt: new Date().toISOString(),
  })

  const host = getRequestHeader(event, 'host') ?? ''
  const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1')
  const cookieName = getSessionCookieName(event)

  setCookie(event, cookieName, id, {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 86400,
    path: '/',
  })

  return id
}

/**
 * Get the current user from the D1 session cookie (app_session).
 * Returns null if the cookie is missing, session is expired, or the user doesn't exist.
 * @optional Use when you need server-side session resolution alongside nuxt-auth-utils.
 */
export async function getSessionUser(event: H3Event): Promise<User | null> {
  const cookieName = getSessionCookieName(event)
  const token = getCookie(event, cookieName)
  if (!token) return null

  const db = useDatabase(event)
  const now = nowSec()

  const rows = await getDatabaseRows<{ users: User }>(
    db
      .select()
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, token), gt(sessions.expiresAt, now)))
      .limit(1),
  )

  const row = rows[0]
  return row?.users ?? null
}

/**
 * Authenticate via API key (Authorization: Bearer nk_...).
 * Returns the user + key metadata, or null if invalid/expired.
 * Updates last_used_at on successful authentication.
 */
export async function authenticateApiKey(event: H3Event): Promise<AuthenticatedApiKey | null> {
  const rawKey = getApiKeyFromAuthorization(event)
  if (!rawKey) return null

  const db = useDatabase(event)
  const keyHash = await hashApiKeyText(rawKey)

  const key = await getDatabaseRow<typeof apiKeys.$inferSelect>(
    db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1),
  )
  if (!key) return null

  // Check expiration
  if (key.expiresAt && key.expiresAt < nowSec()) return null

  const user = await getDatabaseRow<User>(
    db.select().from(users).where(eq(users.id, key.userId)).limit(1),
  )
  if (!user) return null

  // Update last_used_at (fire-and-forget, don't block the response)
  executeDatabaseQuery(
    db.update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, key.id)),
  ).catch((err: unknown) =>
    useLogger(event)
      .child('Auth')
      .warn('Failed to update API key last_used_at', { error: String(err) }),
  )

  return {
    apiKey: key,
    scopes: parseApiKeyScopes(key.scopesJson),
    user,
  }
}

/**
 * Destroy the current D1 session and clear the app_session cookie.
 * @optional Use when you need server-side session revocation alongside nuxt-auth-utils.
 */
export async function destroySession(event: H3Event): Promise<void> {
  const cookieName = getSessionCookieName(event)
  const token = getCookie(event, cookieName)

  if (token) {
    const db = useDatabase(event)
    await executeDatabaseQuery(db.delete(sessions).where(eq(sessions.id, token)))
  }

  deleteCookie(event, cookieName, { path: '/' })
}

/**
 * Get the current user from nuxt-auth-utils session or API key. Throws 401 if not authenticated.
 * Fallback chain: explicit API key bearer auth → sealed session (nuxt-auth-utils) → API key → 401.
 */
export async function requireAuth(event: H3Event): Promise<AuthUser> {
  if (getApiKeyFromAuthorization(event)) {
    const authenticatedApiKey = await authenticateApiKey(event)
    if (!authenticatedApiKey) {
      throw createError({
        statusCode: 401,
        message: 'Unauthorized',
      })
    }

    return {
      id: authenticatedApiKey.user.id,
      email: authenticatedApiKey.user.email,
      name: authenticatedApiKey.user.name,
      isAdmin: authenticatedApiKey.user.isAdmin,
      authMethod: 'api-key',
      scopes: authenticatedApiKey.scopes,
    }
  }

  const session = await getLayerUserSession(event)
  if (session?.user) {
    return {
      ...(session.user as unknown as Omit<AuthUser, 'authMethod' | 'scopes'>),
      authMethod: 'session',
      scopes: [],
    }
  }

  const authenticatedApiKey = await authenticateApiKey(event)
  if (authenticatedApiKey) {
    return {
      id: authenticatedApiKey.user.id,
      email: authenticatedApiKey.user.email,
      name: authenticatedApiKey.user.name,
      isAdmin: authenticatedApiKey.user.isAdmin,
      authMethod: 'api-key',
      scopes: authenticatedApiKey.scopes,
    }
  }

  throw createError({
    statusCode: 401,
    message: 'Unauthorized',
  })
}

/**
 * Require admin authentication. Throws 401 if not authenticated, 403 if not admin.
 */
export async function requireAdmin(event: H3Event): Promise<AuthUser> {
  const user = await requireAuth(event)
  if (!user.isAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Forbidden — admin access required',
    })
  }
  return user
}

/**
 * Generate a new API key. Returns the raw key (show once) and the metadata to store.
 */
export async function generateApiKey(): Promise<{
  keyHash: string
  keyPrefix: string
  rawKey: string
}> {
  const randomBytes = new Uint8Array(32)
  crypto.getRandomValues(randomBytes)
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const rawKey = `${API_KEY_PREFIX}${hex}`
  const keyHash = await hashApiKeyText(rawKey)
  const keyPrefix = rawKey.slice(0, 11) // "nk_" + 8 chars

  return { rawKey, keyHash, keyPrefix }
}
