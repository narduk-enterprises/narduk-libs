import { getHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { authenticateApiKey } from '#layer/server/utils/auth'
import {
  getApiKeyFromAuthorization,
  hasRequiredApiKeyScopes,
  normalizeApiKeyAuthScopes,
} from '#layer/server/utils/authApiKeyText'

import { loadAuthUserRow } from '../lib/app-auth/session'

import { getNativeAuthSession } from './native-auth'
import { sessionPrivilegeRefusal } from './session-privilege'
import { useRefreshedSessionUser } from './session-user'
import { getLocalEmailVerification } from './verified-email'

import type { AppSessionUser } from '../lib/app-auth/types'
import type { H3Event } from 'h3'

/**
 * "Who is calling", for guards that answer an anonymous caller themselves
 * (narduk-libs#980).
 *
 * narduk-core `requireAuth` applies the session-privilege rules (recovery mode,
 * MFA step-up) through the session-grant validator, but it throws 401 on an
 * anonymous caller. A narduk-tenancy resolver needs `null` instead, so the
 * guard can pick 401 or 404. Reading `useRefreshedSessionUser` directly skips
 * those rules; this resolver applies them and returns `null` on a refusal.
 */
export interface RequestPrincipal {
  /** API-key scopes; empty for a session or a native bearer. */
  apiKeyScopes: string[]
  email: string
  /**
   * Whether narduk-auth holds proof this address is the caller's: the Supabase
   * confirmation on a Supabase session, otherwise the local
   * `auth_verified_emails` row for this user and address. Never the raw
   * session field on the local backend.
   */
  emailVerified: boolean
  method: 'session' | 'native' | 'api-key'
  /** The `auth_sessions` or native session id; unset for an API key. */
  sessionId?: string
  userId: string
}

export interface ResolvePrincipalOptions {
  /**
   * Accept an `Authorization: Bearer nk_…` API key. Default false. As in
   * `requireAuth`, an `nk_` bearer takes precedence over the session cookie, and
   * a key that does not authenticate resolves to `null`, not to the session.
   * Without it, a request carrying an `nk_` bearer resolves to `null`: the
   * caller named a key this route does not accept.
   */
  allowApiKey?: boolean
  /**
   * Accept a native-app bearer (`getNativeAuthSession`). Default false. A
   * native bearer takes precedence over the session cookie. On an app without
   * native sign-in (no `authNativeClients`, or not the local backend) there is
   * no native bearer to read, and the call resolves the session as without
   * this option.
   */
  allowNative?: boolean
  /** Refuse a session whose user still has to set a password. Default false. */
  refuseNeedsPasswordSetup?: boolean
  /**
   * With `allowApiKey`, the scopes the key must carry — narduk-core
   * `requireAuthScopes`' rule, answered with `null` instead of 403. Sessions
   * and native bearers are not held to it.
   */
  requiredApiKeyScopes?: readonly string[]
}

function hasBearer(event: H3Event): boolean {
  const header = getHeader(event, 'authorization')
  return typeof header === 'string' && /^bearer\s+\S/iu.test(header.trim())
}

/**
 * Whether this app issues native sessions at all. `nativeAuthClients` throws
 * 404 or 503 when it does not, which suits the native endpoints but not a
 * resolver that answers `null` (narduk-libs#1060).
 */
function nativeSignInEnabled(event: H3Event): boolean {
  const config = useRuntimeConfig(event)
  const clients: unknown = config.authNativeClients
  return Array.isArray(clients) && clients.length > 0 && config.authBackend === 'local'
}

async function localEmailVerified(event: H3Event, userId: string, email: string) {
  return (await getLocalEmailVerification(event, userId, email)) !== null
}

async function sessionEmailVerified(event: H3Event, user: AppSessionUser): Promise<boolean> {
  // Supabase is the authority on its own confirmations; the local backend's is
  // the auth_verified_emails row, keyed by the current address.
  if (user.authBackend === 'supabase') return Boolean(user.emailConfirmedAt)
  return localEmailVerified(event, user.id, user.email)
}

async function resolveApiKeyPrincipal(
  event: H3Event,
  options: ResolvePrincipalOptions,
): Promise<RequestPrincipal | null> {
  const authenticated = await authenticateApiKey(event)
  if (!authenticated) return null
  const required = normalizeApiKeyAuthScopes(options.requiredApiKeyScopes ?? [])
  if (required.length > 0 && !hasRequiredApiKeyScopes(authenticated.scopes, required)) {
    return null
  }
  return {
    apiKeyScopes: authenticated.scopes,
    email: authenticated.user.email,
    emailVerified: await localEmailVerified(event, authenticated.user.id, authenticated.user.email),
    method: 'api-key',
    userId: authenticated.user.id,
  }
}

async function resolveNativePrincipal(event: H3Event): Promise<RequestPrincipal | null> {
  const native = await getNativeAuthSession(event)
  if (!native) return null
  const user = await loadAuthUserRow(event, native.userId)
  if (!user) return null
  return {
    apiKeyScopes: [],
    email: user.email,
    emailVerified: await localEmailVerified(event, user.id, user.email),
    method: 'native',
    sessionId: native.sessionId,
    userId: user.id,
  }
}

async function resolveSessionPrincipal(
  event: H3Event,
  options: ResolvePrincipalOptions,
): Promise<RequestPrincipal | null> {
  const user = await useRefreshedSessionUser(event)
  if (!user) return null
  if (sessionPrivilegeRefusal(event, user)) return null
  if (options.refuseNeedsPasswordSetup && user.needsPasswordSetup) return null
  return {
    apiKeyScopes: [],
    email: user.email,
    emailVerified: await sessionEmailVerified(event, user),
    method: 'session',
    ...(user.authSessionId ? { sessionId: user.authSessionId } : {}),
    userId: user.id,
  }
}

/**
 * Resolves the caller, or `null` for an anonymous caller or one narduk-auth's
 * rules refuse for this request: a recovery-mode or MFA-step-up session outside
 * its allowlist (`session-privilege.ts`), a bearer this call does not accept or
 * that does not authenticate, or an API key without `requiredApiKeyScopes`.
 */
export async function resolveRequestPrincipal(
  event: H3Event,
  options: ResolvePrincipalOptions = {},
): Promise<RequestPrincipal | null> {
  if (getApiKeyFromAuthorization(event)) {
    return options.allowApiKey ? resolveApiKeyPrincipal(event, options) : null
  }
  if (options.allowNative && hasBearer(event) && nativeSignInEnabled(event)) {
    return resolveNativePrincipal(event)
  }
  return resolveSessionPrincipal(event, options)
}

/** A ready-made narduk-tenancy `resolveUserId`: sessions only, privilege rules applied. */
export async function resolveTenancyUserId(event: H3Event): Promise<string | null> {
  return (await resolveRequestPrincipal(event))?.userId ?? null
}
