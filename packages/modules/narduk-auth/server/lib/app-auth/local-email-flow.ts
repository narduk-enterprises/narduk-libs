import { and, eq, gt, isNull } from 'drizzle-orm'
import { createError } from 'h3'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { hashUserPassword } from '#layer/server/utils/password'
import { authEmailLinks } from '#narduk-auth-server/app-orm-tables'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'
import { type User as LocalUser, users } from '#narduk-core/schema'

import { toSessionUser } from './helpers'
import {
  buildLocalEmailActionUrl,
  generateLocalEmailToken,
  hashLocalEmailValue,
  isEmailPreauthorized,
  normalizeEmailAddress,
  sanitizeLocalEmailRedirect,
  selectLocalEmailLinkPurpose,
} from './local-email-core'
import {
  assertLocalEmailDeliveryReady,
  readLocalEmailSettings,
  sendLocalEmailLink,
} from './local-email-runtime'
import {
  assertLocalEmailAttemptAllowed,
  clearLocalEmailAttempts,
  recordLocalEmailAttemptFailure,
} from './local-email-throttle'
import { setCurrentSessionUser } from './session'
import { getAuthConfig } from './supabase-client'

import type { AuthMutationResult, LocalEmailPasswordComplete } from './types'
import type { H3Event } from 'h3'

const GENERIC_REQUEST_MESSAGE =
  'If that email can use this app, a password setup or reset link has been sent.'
const INVALID_LINK_MESSAGE = 'This password link is invalid, expired, or has already been used.'

export async function requestLocalEmailPasswordLink(
  event: H3Event,
  body: { email: string; next?: string | null },
): Promise<AuthMutationResult> {
  const authConfig = getAuthConfig(event)
  const settings = readLocalEmailSettings(event)
  assertLocalEmailDeliveryReady(settings)

  const email = normalizeEmailAddress(body.email)
  await assertLocalEmailAttemptAllowed(event, 'request', email)

  const db = useDatabase(event)
  const user = await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.email, email)),
  )
  const purpose = selectLocalEmailLinkPurpose({
    allowlist: settings.allowlist,
    email,
    userExists: Boolean(user),
  })
  const next = sanitizeLocalEmailRedirect(body.next, authConfig.redirectPath)
  const token = generateLocalEmailToken()
  const actionUrl = buildLocalEmailActionUrl({
    appUrl: settings.appUrl,
    next,
    resetPath: authConfig.resetPath,
    token,
  })

  if (purpose) {
    const appDb = useAuthBridgeDatabase(event)
    const now = new Date().toISOString()
    await executeDatabaseQuery(
      appDb
        .update(authEmailLinks)
        .set({ consumedAt: now })
        .where(and(eq(authEmailLinks.email, email), isNull(authEmailLinks.consumedAt))),
    )
    await appDb.insert(authEmailLinks).values({
      id: crypto.randomUUID(),
      email,
      purpose,
      tokenHash: await hashLocalEmailValue(token),
      redirectPath: next,
      expiresAt: Math.floor(Date.now() / 1000) + settings.tokenTtlMinutes * 60,
      consumedAt: null,
      createdAt: now,
    })

    if (!settings.selfServeLinks) {
      const delivered = await sendLocalEmailLink(event, settings, { actionUrl, email, purpose })
      if (!delivered) {
        useLogger(event).child('AppAuth').error('Local auth link delivery did not complete')
      }
    }
  }

  // Link requests are credentials. Count every request, including unknown addresses,
  // so the response timing and rate-limit behavior do not reveal account existence.
  await recordLocalEmailAttemptFailure(event, 'request', email)

  return {
    user: null,
    nextStep: 'password_recovery_sent',
    message: GENERIC_REQUEST_MESSAGE,
    ...(settings.selfServeLinks ? { selfServeLink: actionUrl } : {}),
  }
}

async function rejectConsumedLink(event: H3Event, principal: string): Promise<never> {
  await recordLocalEmailAttemptFailure(event, 'complete', principal)
  throw createError({ statusCode: 400, statusMessage: INVALID_LINK_MESSAGE })
}

export async function completeLocalEmailPassword(
  event: H3Event,
  body: LocalEmailPasswordComplete,
): Promise<AuthMutationResult> {
  const authConfig = getAuthConfig(event)
  if (authConfig.backend !== 'local') {
    throw createError({
      statusCode: 501,
      statusMessage: 'Local email password completion is not enabled for this app.',
    })
  }

  const token = body.token.trim()
  const tokenHash = await hashLocalEmailValue(token)
  await assertLocalEmailAttemptAllowed(event, 'complete', tokenHash)

  const appDb = useAuthBridgeDatabase(event)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const consumedAt = new Date().toISOString()
  const link = await getDatabaseRow<typeof authEmailLinks.$inferSelect>(
    appDb
      .update(authEmailLinks)
      .set({ consumedAt })
      .where(
        and(
          eq(authEmailLinks.tokenHash, tokenHash),
          isNull(authEmailLinks.consumedAt),
          gt(authEmailLinks.expiresAt, nowSeconds),
        ),
      )
      .returning(),
  )

  if (!link || (link.purpose !== 'setup' && link.purpose !== 'reset')) {
    return rejectConsumedLink(event, tokenHash)
  }

  const settings = readLocalEmailSettings(event)
  if (link.purpose === 'setup' && !isEmailPreauthorized(link.email, settings.allowlist)) {
    return rejectConsumedLink(event, tokenHash)
  }

  const db = useDatabase(event)
  const existingUser = await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.email, link.email)),
  )
  if (link.purpose === 'reset' && !existingUser) {
    return rejectConsumedLink(event, tokenHash)
  }

  const passwordHash = await hashUserPassword(body.newPassword)
  if (link.purpose === 'setup' && !existingUser) {
    await executeDatabaseQuery(
      db.insert(users).values({
        id: crypto.randomUUID(),
        email: link.email,
        passwordHash,
        name: null,
        isAdmin: false,
        updatedAt: consumedAt,
      }),
    )
  } else {
    await executeDatabaseQuery(
      db
        .update(users)
        .set({ passwordHash, updatedAt: consumedAt })
        .where(eq(users.id, existingUser!.id)),
    )
  }

  const user = await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.email, link.email)),
  )
  if (!user) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to complete password setup.' })
  }

  const sessionUser = toSessionUser(user, {
    authBackend: 'local',
    authProvider: 'email',
    authProviders: ['email'],
    needsPasswordSetup: false,
  })
  await setCurrentSessionUser(event, sessionUser)
  await clearLocalEmailAttempts(event, 'complete', tokenHash)

  return {
    user: sessionUser,
    nextStep: 'signed_in',
    redirectTo: sanitizeLocalEmailRedirect(link.redirectPath, authConfig.redirectPath),
  }
}
