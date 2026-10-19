import { and, eq, gt, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'
import { authEmailLinks } from '#narduk-auth/schema'
import { type User as LocalUser, users } from '#narduk-core/schema'

import { recordLocalEmailVerification } from '../../utils/verified-email'

import { deriveDisplayName } from './helpers'
import {
  buildLocalEmailSignInUrl,
  generateLocalEmailToken,
  hashLocalEmailValue,
  mayCreateUserByEmailLink,
  normalizeEmailAddress,
  sanitizeLocalEmailRedirect,
} from './local-email-core'
import {
  assertLocalEmailDeliveryReady,
  type LocalEmailSettings,
  readLocalEmailSettings,
  sendLocalEmailLink,
} from './local-email-runtime'
import {
  assertLocalEmailAttemptAllowed,
  clearLocalEmailAttempts,
  recordLocalEmailAttemptFailure,
} from './local-email-throttle'
import { establishLocalSessionUser } from './session'
import { getAuthConfig, readRuntimeConfigString } from './supabase-client'

import type { AuthMutationResult } from './types'
import type { H3Event } from 'h3'

/**
 * Passwordless sign-in and sign-up by email link on the local backend
 * (narduk-libs#1952), on the same `auth_email_links` rows, TTL bounds and
 * throttle as the password setup and reset links.
 *
 * Requesting answers the same for every address. A link is issued only to an
 * existing account, or to a new address when the app lets a link create the
 * account. The raw token is mailed once and stored only as its SHA-256 digest;
 * it is redeemed by an explicit POST, never by loading the page, and the
 * redemption is claimed by one conditional update so a link signs in once.
 */

export const DEFAULT_EMAIL_LINK_PATH = '/auth/email-link'
const GENERIC_REQUEST_MESSAGE =
  'If that email can sign in to this app, a sign-in link has been sent.'
const INVALID_LINK_MESSAGE = 'This sign-in link is invalid, expired, or has already been used.'

function assertEmailLinkSignInEnabled(event: H3Event, settings: LocalEmailSettings): void {
  if (getAuthConfig(event).backend !== 'local' || !settings.emailLinkSignIn) {
    throw createError({
      statusCode: 501,
      statusMessage: 'Email sign-in links are not enabled for this app.',
    })
  }
}

function mayCreateUser(event: H3Event, settings: LocalEmailSettings, email: string): boolean {
  return mayCreateUserByEmailLink({
    allowlist: settings.allowlist,
    createUsers: settings.emailLinkCreateUsers,
    email,
    publicSignup: getAuthConfig(event).publicSignup,
  })
}

function emailLinkPath(event: H3Event): string {
  const config = useRuntimeConfig(event) as unknown as { public?: Record<string, unknown> }
  return readRuntimeConfigString(config.public?.authEmailLinkPath, DEFAULT_EMAIL_LINK_PATH)
}

export async function requestLocalEmailSignInLink(
  event: H3Event,
  body: { email: string; next?: string | null },
): Promise<AuthMutationResult> {
  const authConfig = getAuthConfig(event)
  const settings = readLocalEmailSettings(event)
  assertEmailLinkSignInEnabled(event, settings)
  assertLocalEmailDeliveryReady(settings)

  const email = normalizeEmailAddress(body.email)
  // One budget with password-link requests: a link of either kind is a credential.
  await assertLocalEmailAttemptAllowed(event, 'request', email)

  const user = await getDatabaseRow<LocalUser>(
    useDatabase(event).select().from(users).where(eq(users.email, email)),
  )
  const next = sanitizeLocalEmailRedirect(body.next, authConfig.redirectPath)
  const token = generateLocalEmailToken()
  const actionUrl = buildLocalEmailSignInUrl({
    appUrl: settings.appUrl,
    next,
    signInPath: emailLinkPath(event),
    token,
  })

  if (user || mayCreateUser(event, settings, email)) {
    const appDb = useAuthBridgeDatabase(event)
    const now = new Date().toISOString()
    // One live link per address, whatever its purpose.
    await executeDatabaseQuery(
      appDb
        .update(authEmailLinks)
        .set({ consumedAt: now })
        .where(and(eq(authEmailLinks.email, email), isNull(authEmailLinks.consumedAt))),
    )
    await executeDatabaseQuery(
      appDb.insert(authEmailLinks).values({
        id: crypto.randomUUID(),
        email,
        purpose: 'signin',
        tokenHash: await hashLocalEmailValue(token),
        redirectPath: next,
        expiresAt: Math.floor(Date.now() / 1000) + settings.tokenTtlMinutes * 60,
        consumedAt: null,
        createdAt: now,
      }),
    )

    if (!settings.selfServeLinks) {
      const delivered = await sendLocalEmailLink(event, settings, {
        actionUrl,
        email,
        purpose: 'signin',
      })
      if (!delivered) {
        useLogger(event).child('AppAuth').error('Local auth link delivery did not complete')
      }
    }
  }

  // Count every request, including unknown addresses, so neither the response
  // nor the rate limit reveals whether an account exists.
  await recordLocalEmailAttemptFailure(event, 'request', email)

  return {
    user: null,
    nextStep: 'email_link_sent',
    message: GENERIC_REQUEST_MESSAGE,
    ...(settings.selfServeLinks ? { selfServeLink: actionUrl } : {}),
  }
}

async function rejectLink(event: H3Event, tokenHash: string): Promise<never> {
  await recordLocalEmailAttemptFailure(event, 'complete', tokenHash)
  throw createError({ statusCode: 400, statusMessage: INVALID_LINK_MESSAGE })
}

export async function redeemLocalEmailSignInLink(
  event: H3Event,
  body: { token: string },
): Promise<AuthMutationResult> {
  const authConfig = getAuthConfig(event)
  const settings = readLocalEmailSettings(event)
  assertEmailLinkSignInEnabled(event, settings)

  const tokenHash = await hashLocalEmailValue(body.token.trim())
  await assertLocalEmailAttemptAllowed(event, 'complete', tokenHash)

  const nowSeconds = Math.floor(Date.now() / 1000)
  const consumedAt = new Date().toISOString()
  // The claim: only one request can move this row from unconsumed to consumed.
  // A password link never matches here, so posting one is refused, not spent.
  const link = await getDatabaseRow<typeof authEmailLinks.$inferSelect>(
    useAuthBridgeDatabase(event)
      .update(authEmailLinks)
      .set({ consumedAt })
      .where(
        and(
          eq(authEmailLinks.tokenHash, tokenHash),
          eq(authEmailLinks.purpose, 'signin'),
          isNull(authEmailLinks.consumedAt),
          gt(authEmailLinks.expiresAt, nowSeconds),
        ),
      )
      .returning(),
  )
  if (!link) return rejectLink(event, tokenHash)

  const db = useDatabase(event)
  let user = await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.email, link.email)),
  )
  if (!user) {
    // Re-checked at redemption: closing sign-up after a link went out wins.
    if (!mayCreateUser(event, settings, link.email)) return rejectLink(event, tokenHash)
    await executeDatabaseQuery(
      db.insert(users).values({
        id: crypto.randomUUID(),
        email: link.email,
        name: deriveDisplayName(link.email),
        passwordHash: null,
        isAdmin: false,
        createdAt: consumedAt,
        updatedAt: consumedAt,
      }),
    )
    user = await getDatabaseRow<LocalUser>(
      db.select().from(users).where(eq(users.email, link.email)),
    )
    if (!user) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to create the account.' })
    }
  }

  // Redeeming the link proves control of the address.
  await recordLocalEmailVerification(event, user.id, link.email, consumedAt)
  const sessionUser = await establishLocalSessionUser(event, user, {
    authProvider: 'email',
    authProviders: ['email'],
    emailConfirmedAt: consumedAt,
    needsPasswordSetup: !user.passwordHash,
  })
  await clearLocalEmailAttempts(event, 'complete', tokenHash)

  return {
    user: sessionUser,
    nextStep: 'signed_in',
    redirectTo: sanitizeLocalEmailRedirect(link.redirectPath, authConfig.redirectPath),
  }
}
