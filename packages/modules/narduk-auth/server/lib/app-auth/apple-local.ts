import {
  deleteAppCookie,
  readAppCookie,
  setAppCookie,
} from '@narduk-enterprises/narduk-app/server/http'
import { eq } from 'drizzle-orm'
import { createError } from 'h3'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { type User as LocalUser, users } from '#narduk-core/schema'

import { getLocalEmailVerification, recordLocalEmailVerification } from '../../utils/verified-email'

import {
  APPLE_AUTHORIZE_URL,
  type AppleIdentityClaims,
  type AppleJwksFetcher,
  hashAppleNonce,
  randomAppleToken,
  verifyAppleIdentityToken,
} from './apple-identity'
import { deriveDisplayName, getSessionCookieSecure, sanitizeNextPath } from './helpers'
import { establishLocalSessionUser } from './session'
import { getAuthConfig } from './supabase-client'

import type { AppleSignInConfig } from '../../../shared/utils/apple-sign-in-config'
import type { AppSessionUser } from './types'
import type { H3Event } from 'h3'

/**
 * Sign in with Apple on the local D1 backend (narduk-libs#164).
 *
 * Web: `GET /api/auth/apple/start` binds a random `state` and raw nonce to this
 * browser in a short-lived cookie and redirects to Apple with
 * `response_type=code id_token` and `response_mode=form_post`. Apple POSTs the
 * identity token to `/api/callbacks/auth/apple`, which checks `state`, verifies
 * the token (`apple-identity.ts`: Apple's JWKS, `iss`, `aud` = the Services ID,
 * `exp`, nonce) and signs the user in. The authorization code is not redeemed,
 * so no Apple client-secret JWT is needed for sign-in.
 *
 * Native: `signInWithNativeApple` verifies a bundle-id identity token the same
 * way and signs in through `signInWithAppleIdentity`.
 */

/** Under `/api/callbacks/`: narduk-core's header CSRF check exempts it, since Apple's POST cannot send one. */
export const APPLE_CALLBACK_PATH = '/api/callbacks/auth/apple'
const APPLE_COOKIE = 'narduk_apple_signin'
// Covers both /api/auth/apple/start (set) and /api/callbacks/auth/apple (read).
const APPLE_COOKIE_PATH = '/api'
const APPLE_COOKIE_MAX_AGE_SECONDS = 10 * 60

function appleCookieOptions(event: H3Event) {
  const secure = getSessionCookieSecure(event)
  // Apple's form_post is a cross-site POST: a Lax cookie would not come back.
  // SameSite=None needs Secure, so plain-http localhost keeps Lax.
  return {
    httpOnly: true,
    path: APPLE_COOKIE_PATH,
    sameSite: secure ? ('none' as const) : ('lax' as const),
    secure,
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

export function assertLocalAppleWebEnabled(apple: AppleSignInConfig): void {
  if (!apple.webEnabled) {
    throw createError({
      statusCode: 501,
      statusMessage: 'Sign in with Apple is not configured for this app.',
    })
  }
}

/** Returns the Apple authorize URL for this browser; sets the binding cookie. */
export async function startLocalAppleWebSignIn(
  event: H3Event,
  apple: AppleSignInConfig,
  next: string | null | undefined,
): Promise<string> {
  assertLocalAppleWebEnabled(apple)
  const config = getAuthConfig(event)
  const state = randomAppleToken()
  const rawNonce = randomAppleToken()
  const safeNext = sanitizeNextPath(next, config.redirectPath)
  setAppCookie(event, APPLE_COOKIE, JSON.stringify({ state, rawNonce, next: safeNext }), {
    ...appleCookieOptions(event),
    maxAge: APPLE_COOKIE_MAX_AGE_SECONDS,
  })

  const url = new URL(APPLE_AUTHORIZE_URL)
  url.searchParams.set('client_id', apple.servicesId)
  url.searchParams.set('redirect_uri', new URL(APPLE_CALLBACK_PATH, config.appUrl).toString())
  url.searchParams.set('response_type', 'code id_token')
  url.searchParams.set('response_mode', 'form_post')
  url.searchParams.set('scope', 'name email')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', await hashAppleNonce(rawNonce))
  return url.toString()
}

export interface AppleCallbackForm {
  error?: string
  id_token?: string
  state?: string
  /** JSON Apple sends on the first authorization only: `{ name: { firstName, lastName } }`. */
  user?: string
}

interface AppleBinding {
  next: string
  rawNonce: string
  state: string
}

function readAppleBinding(event: H3Event): AppleBinding | null {
  const raw = readAppCookie(event, APPLE_COOKIE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AppleBinding>
    if (
      typeof parsed.state === 'string' &&
      typeof parsed.rawNonce === 'string' &&
      typeof parsed.next === 'string'
    ) {
      return { state: parsed.state, rawNonce: parsed.rawNonce, next: parsed.next }
    }
  } catch {
    // fall through: a malformed binding is no binding
  }
  return null
}

/** The display name Apple sends once, on first authorization; never its email. */
export function appleFormDisplayName(user: string | undefined): string | null {
  if (!user) return null
  try {
    const parsed = JSON.parse(user) as { name?: { firstName?: unknown; lastName?: unknown } }
    const name = [parsed.name?.firstName, parsed.name?.lastName]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim())
      .join(' ')
    return name ? name.slice(0, 200) : null
  } catch {
    return null
  }
}

function callbackError(message: string, code: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}

/** Verifies Apple's form_post and signs in; returns the same-origin path to go to. */
export async function completeLocalAppleWebSignIn(
  event: H3Event,
  apple: AppleSignInConfig,
  form: AppleCallbackForm,
  options: { fetchJwks?: AppleJwksFetcher } = {},
): Promise<{ redirectTo: string; user: AppSessionUser }> {
  assertLocalAppleWebEnabled(apple)
  const binding = readAppleBinding(event)
  // Single use: whatever happens next, this binding is spent.
  deleteAppCookie(event, APPLE_COOKIE, appleCookieOptions(event))

  if (form.error) callbackError('Sign in with Apple was cancelled.', 'apple_cancelled')
  if (!binding || !form.state || !constantTimeEqual(binding.state, form.state)) {
    callbackError('Sign in with Apple expired. Start again.', 'apple_state_mismatch')
  }
  if (!form.id_token) callbackError('Apple returned no identity token.', 'apple_token_missing')

  const claims = await verifyAppleIdentityToken(form.id_token, {
    audiences: [apple.servicesId],
    rawNonce: binding.rawNonce,
    ...(options.fetchJwks ? { fetchJwks: options.fetchJwks } : {}),
  })
  const user = await signInWithAppleIdentity(event, claims, {
    displayName: appleFormDisplayName(form.user),
  })
  return { redirectTo: binding.next, user }
}

async function findUser(event: H3Event, column: 'appleId' | 'email', value: string) {
  return getDatabaseRow<LocalUser>(
    useDatabase(event)
      .select()
      .from(users)
      .where(eq(column === 'appleId' ? users.appleId : users.email, value)),
  )
}

async function linkAppleToExistingUser(
  event: H3Event,
  user: LocalUser,
  claims: AppleIdentityClaims,
): Promise<LocalUser> {
  // Linking by address is only safe when this app also holds proof the
  // account's owner controls it. Otherwise whoever registered the address
  // first (unproven) would share the account with its real owner.
  const proven = await getLocalEmailVerification(event, user.id, user.email)
  if (user.appleId || !proven) {
    useLogger(event)
      .child('AppAuth')
      .warn('Refused to link Apple ID to an existing account', {
        localUserId: user.id,
        reason: user.appleId ? 'different_apple_id' : 'email_not_proven',
      })
    throw createError({
      statusCode: 409,
      statusMessage:
        'An account with this email already exists. Sign in with your password instead.',
      data: { code: 'apple_link_refused' },
    })
  }
  const updatedAt = new Date().toISOString()
  await executeDatabaseQuery(
    useDatabase(event)
      .update(users)
      .set({ appleId: claims.appleId, updatedAt })
      .where(eq(users.id, user.id)),
  )
  return { ...user, appleId: claims.appleId, updatedAt }
}

async function createAppleUser(
  event: H3Event,
  claims: AppleIdentityClaims & { email: string },
  displayName: string | null,
): Promise<LocalUser> {
  if (!getAuthConfig(event).publicSignup) {
    throw createError({ statusCode: 403, statusMessage: 'Public signup is disabled for this app.' })
  }
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const db = useDatabase(event)
  await db.insert(users).values({
    id,
    email: claims.email,
    name: displayName ?? deriveDisplayName(claims.email),
    appleId: claims.appleId,
    passwordHash: null,
    isAdmin: false,
    createdAt: now,
    updatedAt: now,
  })
  const user = await getDatabaseRow<LocalUser>(db.select().from(users).where(eq(users.id, id)))
  if (!user) throw createError({ statusCode: 500, statusMessage: 'Failed to create the account.' })
  return user
}

/**
 * Signs in a verified Apple identity on the local backend. The user is found by
 * `users.apple_id`; failing that, an Apple-verified address links to an existing
 * account whose address this app has also proven; failing that, a new account
 * with no password is created when public sign-up is open.
 */
export async function signInWithAppleIdentity(
  event: H3Event,
  claims: AppleIdentityClaims,
  options: { displayName?: string | null } = {},
): Promise<AppSessionUser> {
  let user = await findUser(event, 'appleId', claims.appleId)
  if (!user) {
    if (!claims.email || !claims.emailVerified) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Apple did not share a verified email address.',
        data: { code: 'apple_email_missing' },
      })
    }
    const existing = await findUser(event, 'email', claims.email)
    user = existing
      ? await linkAppleToExistingUser(event, existing, claims)
      : await createAppleUser(
          event,
          { ...claims, email: claims.email },
          options.displayName ?? null,
        )
  }

  let emailConfirmedAt = await getLocalEmailVerification(event, user.id, user.email)
  if (!emailConfirmedAt && claims.emailVerified && claims.email === user.email) {
    // Apple verified this exact address: that is proof it belongs to the user.
    emailConfirmedAt = new Date().toISOString()
    await recordLocalEmailVerification(event, user.id, user.email, emailConfirmedAt)
  }

  return establishLocalSessionUser(event, user, {
    authProvider: 'apple',
    authProviders: user.passwordHash ? ['apple', 'email'] : ['apple'],
    emailConfirmedAt,
    needsPasswordSetup: !user.passwordHash,
  })
}
