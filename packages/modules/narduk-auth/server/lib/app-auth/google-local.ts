import {
  deleteAppCookie,
  readAppCookie,
  setAppCookie,
} from '@narduk-enterprises/narduk-app/server/http'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'
import { authIdentities } from '#narduk-auth/schema'
import { type User as LocalUser, users } from '#narduk-core/schema'

import { getLocalEmailVerification, recordLocalEmailVerification } from '../../utils/verified-email'

import {
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_TOKEN_URL,
  type GoogleIdentityClaims,
  type GoogleJwksFetcher,
  verifyGoogleIdToken,
} from './google-identity'
import { deriveDisplayName, getSessionCookieSecure, sanitizeNextPath } from './helpers'
import { constantTimeEqual, randomHexToken, sha256Hex } from './jwt-rs256'
import { bytesToBase64Url } from './local-email-core'
import { establishLocalSessionUser } from './session'
import { getAuthConfig } from './supabase-client'

import type { GoogleSignInConfig } from '../../../shared/utils/google-sign-in-config'
import type { AppSessionUser } from './types'
import type { H3Event } from 'h3'

/**
 * Google sign-in on the local backend (narduk-libs#1951): the OpenID Connect
 * authorization code flow with PKCE, `state` and a nonce.
 *
 * `GET /api/auth/google/start` binds a random `state`, raw nonce and PKCE
 * verifier to this browser in a short-lived cookie and redirects to Google.
 * Google redirects back to `GET /api/callbacks/auth/google` with a code; the
 * callback spends the cookie, checks `state`, redeems the code with the client
 * secret and the PKCE verifier, verifies the ID token (`google-identity.ts`:
 * Google's JWKS, `iss`, `aud` = the client id, `exp`, nonce) and signs the
 * user in under the same account-linking rule as Sign in with Apple.
 */

export const GOOGLE_CALLBACK_PATH = '/api/callbacks/auth/google'
const GOOGLE_COOKIE = 'narduk_google_signin'
// Covers both /api/auth/google/start (set) and /api/callbacks/auth/google (read).
const GOOGLE_COOKIE_PATH = '/api'
const GOOGLE_COOKIE_MAX_AGE_SECONDS = 10 * 60

function googleCookieOptions(event: H3Event) {
  // Google returns with a top-level GET navigation, which carries a Lax cookie.
  return {
    httpOnly: true,
    path: GOOGLE_COOKIE_PATH,
    sameSite: 'lax' as const,
    secure: getSessionCookieSecure(event),
  }
}

export function assertLocalGoogleWebEnabled(google: GoogleSignInConfig): void {
  if (!google.webEnabled) {
    throw createError({
      statusCode: 501,
      statusMessage: 'Google sign-in is not configured for this app.',
    })
  }
}

function googleRedirectUri(appUrl: string): string {
  return new URL(GOOGLE_CALLBACK_PATH, appUrl).toString()
}

async function pkceChallenge(verifier: string): Promise<string> {
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  )
}

/** Returns the Google authorize URL for this browser; sets the binding cookie. */
export async function startLocalGoogleWebSignIn(
  event: H3Event,
  google: GoogleSignInConfig,
  next: string | null | undefined,
): Promise<string> {
  assertLocalGoogleWebEnabled(google)
  const config = getAuthConfig(event)
  const state = randomHexToken()
  const rawNonce = randomHexToken()
  // 64 hex characters: inside RFC 7636's 43-128 unreserved-character range.
  const codeVerifier = randomHexToken()
  const safeNext = sanitizeNextPath(next, config.redirectPath)
  setAppCookie(
    event,
    GOOGLE_COOKIE,
    JSON.stringify({ state, rawNonce, codeVerifier, next: safeNext }),
    { ...googleCookieOptions(event), maxAge: GOOGLE_COOKIE_MAX_AGE_SECONDS },
  )

  const url = new URL(GOOGLE_AUTHORIZE_URL)
  url.searchParams.set('client_id', google.clientId)
  url.searchParams.set('redirect_uri', googleRedirectUri(config.appUrl))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', await sha256Hex(rawNonce))
  url.searchParams.set('code_challenge', await pkceChallenge(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

export interface GoogleCallbackQuery {
  code?: string
  error?: string
  state?: string
}

interface GoogleBinding {
  codeVerifier: string
  next: string
  rawNonce: string
  state: string
}

function readGoogleBinding(event: H3Event): GoogleBinding | null {
  const raw = readAppCookie(event, GOOGLE_COOKIE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleBinding>
    if (
      typeof parsed.state === 'string' &&
      typeof parsed.rawNonce === 'string' &&
      typeof parsed.codeVerifier === 'string' &&
      typeof parsed.next === 'string'
    ) {
      return {
        state: parsed.state,
        rawNonce: parsed.rawNonce,
        codeVerifier: parsed.codeVerifier,
        next: parsed.next,
      }
    }
  } catch {
    // fall through: a malformed binding is no binding
  }
  return null
}

function googleLog(event: H3Event) {
  return useLogger(event).child('AppAuth')
}

function callbackError(event: H3Event, message: string, code: string): never {
  // A cancel is the user's choice; anything else is a broken or replayed flow.
  const log = googleLog(event)
  if (code === 'google_cancelled') log.info('Google sign-in cancelled')
  else log.warn('Google sign-in callback refused', { code })
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}

async function redeemGoogleCode(
  event: H3Event,
  params: { clientId: string; clientSecret: string; code: string; codeVerifier: string },
  redirectUri: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        code_verifier: params.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Google sign-in is unavailable. Try again shortly.',
    })
  }
  if (!response.ok) {
    // Google's error body names the reason (invalid_grant for a spent code);
    // only the status is logged, never the body or the code.
    googleLog(event).warn('Google refused the authorization code', { status: response.status })
    callbackError(event, 'Google sign-in expired. Start again.', 'google_code_rejected')
  }
  const payload = (await response.json().catch(() => null)) as { id_token?: unknown } | null
  if (typeof payload?.id_token !== 'string' || !payload.id_token) {
    callbackError(event, 'Google returned no identity token.', 'google_token_missing')
  }
  return payload.id_token
}

/** Verifies Google's redirect and signs in; returns the same-origin path to go to. */
export async function completeLocalGoogleWebSignIn(
  event: H3Event,
  google: GoogleSignInConfig,
  query: GoogleCallbackQuery,
  options: { fetch?: typeof globalThis.fetch; fetchJwks?: GoogleJwksFetcher } = {},
): Promise<{ redirectTo: string; user: AppSessionUser }> {
  assertLocalGoogleWebEnabled(google)
  const binding = readGoogleBinding(event)
  // Single use: whatever happens next, this binding is spent.
  deleteAppCookie(event, GOOGLE_COOKIE, googleCookieOptions(event))

  if (query.error) callbackError(event, 'Google sign-in was cancelled.', 'google_cancelled')
  if (!binding || !query.state || !constantTimeEqual(binding.state, query.state)) {
    callbackError(event, 'Google sign-in expired. Start again.', 'google_state_mismatch')
  }
  if (!query.code)
    callbackError(event, 'Google returned no authorization code.', 'google_code_missing')

  const idToken = await redeemGoogleCode(
    event,
    {
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      code: query.code,
      codeVerifier: binding.codeVerifier,
    },
    googleRedirectUri(getAuthConfig(event).appUrl),
    options.fetch ?? globalThis.fetch,
  )
  const claims = await verifyGoogleIdToken(idToken, {
    clientId: google.clientId,
    rawNonce: binding.rawNonce,
    ...(options.fetchJwks ? { fetchJwks: options.fetchJwks } : {}),
  }).catch((error: unknown) => {
    // `reason` is a fixed code from verifyGoogleIdToken; never the token.
    const reason = (error as { data?: { reason?: unknown } } | null)?.data?.reason
    googleLog(event).warn('Google identity token refused', {
      reason: typeof reason === 'string' ? reason : 'verification_failed',
    })
    throw error
  })
  const user = await signInWithGoogleIdentity(event, claims)
  return { redirectTo: binding.next, user }
}

async function findUserById(event: H3Event, id: string) {
  return getDatabaseRow<LocalUser>(useDatabase(event).select().from(users).where(eq(users.id, id)))
}

async function findUserByEmail(event: H3Event, email: string) {
  return getDatabaseRow<LocalUser>(
    useDatabase(event).select().from(users).where(eq(users.email, email)),
  )
}

async function findGoogleIdentity(event: H3Event, column: 'subject' | 'userId', value: string) {
  return getDatabaseRow<typeof authIdentities.$inferSelect>(
    useAuthBridgeDatabase(event)
      .select()
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, 'google'),
          eq(column === 'subject' ? authIdentities.subject : authIdentities.userId, value),
        ),
      ),
  )
}

async function insertGoogleIdentity(
  event: H3Event,
  userId: string,
  claims: GoogleIdentityClaims,
  now: string,
): Promise<void> {
  await executeDatabaseQuery(
    useAuthBridgeDatabase(event).insert(authIdentities).values({
      id: crypto.randomUUID(),
      provider: 'google',
      subject: claims.googleSub,
      userId,
      email: claims.email,
      createdAt: now,
      lastSignInAt: now,
    }),
  )
}

function refuseLink(event: H3Event, userId: string, reason: string): never {
  googleLog(event).warn('Refused to link a Google account to an existing account', {
    localUserId: userId,
    reason,
  })
  throw createError({
    statusCode: 409,
    statusMessage: 'An account with this email already exists. Sign in with your password instead.',
    data: { code: 'google_link_refused' },
  })
}

async function linkGoogleToExistingUser(
  event: H3Event,
  user: LocalUser,
  claims: GoogleIdentityClaims,
): Promise<LocalUser> {
  // Linking by address is only safe when this app also holds proof the
  // account's owner controls it. Otherwise whoever registered the address
  // first (unproven) would share the account with its real owner.
  const proven = await getLocalEmailVerification(event, user.id, user.email)
  if (!proven) refuseLink(event, user.id, 'email_not_proven')
  if (await findGoogleIdentity(event, 'userId', user.id)) {
    refuseLink(event, user.id, 'different_google_account')
  }
  await insertGoogleIdentity(event, user.id, claims, new Date().toISOString())
  return user
}

async function createGoogleUser(
  event: H3Event,
  claims: GoogleIdentityClaims & { email: string },
): Promise<LocalUser> {
  if (!getAuthConfig(event).publicSignup) {
    throw createError({ statusCode: 403, statusMessage: 'Public signup is disabled for this app.' })
  }
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await executeDatabaseQuery(
    useDatabase(event)
      .insert(users)
      .values({
        id,
        email: claims.email,
        name: claims.name ?? deriveDisplayName(claims.email),
        passwordHash: null,
        isAdmin: false,
        createdAt: now,
        updatedAt: now,
      }),
  )
  await insertGoogleIdentity(event, id, claims, now)
  const user = await findUserById(event, id)
  if (!user) throw createError({ statusCode: 500, statusMessage: 'Failed to create the account.' })
  return user
}

/**
 * Signs in a verified Google identity on the local backend. The user is found
 * by its `auth_identities` row (`provider = 'google'`, `subject` = `sub`),
 * which is also where imported Supabase identities land; failing that, a
 * Google-verified address links to an existing account whose address this app
 * has also proven; failing that, a new account with no password is created
 * when public sign-up is open.
 */
export async function signInWithGoogleIdentity(
  event: H3Event,
  claims: GoogleIdentityClaims,
): Promise<AppSessionUser> {
  const identity = await findGoogleIdentity(event, 'subject', claims.googleSub)
  let user: LocalUser | undefined
  if (identity) {
    // auth_identities.user_id cascades from users, so the row is always there.
    user = await findUserById(event, identity.userId)
    if (!user) throw createError({ statusCode: 500, statusMessage: 'Failed to load the account.' })
    await executeDatabaseQuery(
      useAuthBridgeDatabase(event)
        .update(authIdentities)
        .set({ lastSignInAt: new Date().toISOString() })
        .where(eq(authIdentities.id, identity.id)),
    )
  } else {
    if (!claims.email || !claims.emailVerified) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Google did not share a verified email address.',
        data: { code: 'google_email_missing' },
      })
    }
    const existing = await findUserByEmail(event, claims.email)
    user = existing
      ? await linkGoogleToExistingUser(event, existing, claims)
      : await createGoogleUser(event, { ...claims, email: claims.email })
  }

  let emailConfirmedAt = await getLocalEmailVerification(event, user.id, user.email)
  if (!emailConfirmedAt && claims.emailVerified && claims.email === user.email) {
    // Google verified this exact address: that is proof it belongs to the user.
    emailConfirmedAt = new Date().toISOString()
    await recordLocalEmailVerification(event, user.id, user.email, emailConfirmedAt)
  }

  return establishLocalSessionUser(event, user, {
    authProvider: 'google',
    authProviders: user.passwordHash ? ['google', 'email'] : ['google'],
    emailConfirmedAt,
    needsPasswordSetup: !user.passwordHash,
  })
}
