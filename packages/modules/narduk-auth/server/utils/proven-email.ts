import { eq } from 'drizzle-orm'
import { createError } from 'h3'

import { getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { hashUserPassword } from '#layer/server/utils/password'
import { type User as LocalUser, users } from '#narduk-core/schema'

import { normalizeEmail } from '../lib/app-auth/helpers'
import {
  establishLocalSessionUser,
  getCurrentSessionUser,
  setCurrentSessionUser,
} from '../lib/app-auth/session'
import { getAuthConfig } from '../lib/app-auth/supabase-client'

import { recordLocalEmailVerification } from './verified-email'

import type { AppSessionUser } from '../lib/app-auth/types'
import type { H3Event } from 'h3'

/**
 * Account creation for an address the app has already proven.
 *
 * The caller owns the proof. The usual one is a single-use token the app
 * emailed to this address (an invitation), redeemed on the same request:
 * whoever holds it read that inbox, so no second confirmation email is needed.
 * Never call this with an address the visitor merely typed.
 *
 * It is deliberately independent of `publicSignup`: an app with closed sign-up
 * still admits the people it invited. Local backend only; a Supabase app
 * creates accounts through Supabase.
 */
export async function registerLocalUserWithProvenEmail(
  event: H3Event,
  input: { email: string; name: string; password: string },
): Promise<AppSessionUser> {
  if (getAuthConfig(event).backend !== 'local') {
    throw createError({
      statusCode: 501,
      statusMessage: 'Proven-email registration needs the local auth backend.',
    })
  }
  const name = input.name.trim()
  if (name.length < 2 || name.length > 200 || input.password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Name or password is too short.' })
  }
  const email = normalizeEmail(input.email)
  const db = useDatabase(event)
  const existing = await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.email, email)),
  )
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'Email already in use' })
  }

  const userId = crypto.randomUUID()
  await db.insert(users).values({
    id: userId,
    email,
    name,
    passwordHash: await hashUserPassword(input.password),
  })
  const user = await getDatabaseRow<LocalUser>(db.select().from(users).where(eq(users.id, userId)))
  if (!user) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create the local account.' })
  }

  const verifiedAt = new Date().toISOString()
  await recordLocalEmailVerification(event, user.id, user.email, verifiedAt)
  return establishLocalSessionUser(event, user, {
    authProvider: 'email',
    authProviders: ['email'],
    emailConfirmedAt: verifiedAt,
    needsPasswordSetup: false,
  })
}

/**
 * Marks the signed-in user's own address as proven, for the same kind of
 * proof as above (they redeemed a token that was emailed to it).
 *
 * Returns the updated session user, or null when nobody is signed in or the
 * proven address is not the session's address -- proof for one inbox never
 * confirms another.
 */
export async function confirmSessionEmailWithProof(
  event: H3Event,
  provenEmail: string,
): Promise<AppSessionUser | null> {
  const sessionUser = await getCurrentSessionUser(event)
  if (!sessionUser) return null
  if (normalizeEmail(sessionUser.email) !== normalizeEmail(provenEmail)) return null
  if (sessionUser.emailConfirmedAt) return sessionUser
  const verifiedAt = new Date().toISOString()
  await recordLocalEmailVerification(event, sessionUser.id, sessionUser.email, verifiedAt)
  const updated = { ...sessionUser, emailConfirmedAt: verifiedAt }
  await setCurrentSessionUser(event, updated)
  return updated
}
