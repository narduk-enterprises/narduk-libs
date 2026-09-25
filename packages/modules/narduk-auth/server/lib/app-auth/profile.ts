import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { hashUserPassword, verifyUserPassword } from '#layer/server/utils/password'
import { replaceLayerUserSession } from '#layer/server/utils/user-session'
import { type User as LocalUser, users } from '#narduk-core/schema'

import { useNativeAuth } from '../../utils/native-auth'
import { useRefreshedSessionUser } from '../../utils/session-user'

import { encodeQrCodeDataUrl } from './helpers'
import { ensureLinkedLocalUser } from './linking'
import {
  clearAuthSessionRecoveryMode,
  commitSupabaseSessionFromClient,
  getCurrentSessionUser,
  getCurrentSupabaseContext,
  loadAuthSessionRow,
  revokeUserAuthSessions,
} from './session'
import {
  createSupabaseUserClient,
  getAuthConfig,
  readRuntimeConfigString,
  toSupabaseHttpError,
} from './supabase-client'

import type {
  AppSessionUser,
  ChangePasswordInput,
  MfaEnrollmentResult,
  UpdateProfileInput,
  VerifyMfaInput,
} from './types'
import type { H3Event } from 'h3'

export async function updateProfile(event: H3Event, body: UpdateProfileInput) {
  const config = getAuthConfig(event)
  const name = typeof body.name === 'string' ? body.name.trim() : undefined
  const sessionUser = await getCurrentSessionUser(event)
  if (!sessionUser) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  if (config.backend === 'supabase' && sessionUser.authSessionId) {
    const context = await getCurrentSupabaseContext(event)
    const { data, error } = await context.client.updateUser({
      data: {
        ...(name !== undefined ? { name, full_name: name, display_name: name } : {}),
      },
    })

    if (error) {
      toSupabaseHttpError(error)
    }

    const db = useDatabase(event)
    await executeDatabaseQuery(
      db
        .update(users)
        .set({
          ...(name !== undefined ? { name } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, context.localUser.id)),
    )

    await ensureLinkedLocalUser(event, data.user)
    await commitSupabaseSessionFromClient(event, {
      client: context.client,
      localUser: context.localUser,
      authUser: data.user,
      authSessionId: context.authSessionId,
    })

    const refreshedUser = {
      ...context.sessionUser,
      ...(name !== undefined ? { name } : {}),
    }
    await replaceLayerUserSession(event, { user: refreshedUser })

    return { ok: true, user: refreshedUser }
  }

  const db = useDatabase(event)
  await executeDatabaseQuery(
    db
      .update(users)
      .set({
        ...(name !== undefined ? { name } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, sessionUser.id)),
  )

  const refreshedUser = {
    ...sessionUser,
    ...(name !== undefined ? { name } : {}),
  }
  await replaceLayerUserSession(event, { user: refreshedUser })

  return { ok: true, user: refreshedUser }
}

/**
 * Re-authenticates a Supabase email+password session against Supabase itself.
 * The local `users.password_hash` is never the source of truth on this
 * backend: Supabase-provisioned users have none, and a user linked after a
 * migration can still carry a stale one (narduk-libs#923).
 *
 * Sessions without the `email` provider have no password to prove and skip
 * the check (account deletion holds them to `assertRecentSupabaseSignIn`
 * instead), as does a recovery session, which the session-privilege rules
 * already confine to `change-password`.
 *
 * An invited or magic-link user has the `email` provider whether or not they
 * ever chose a password, and Supabase does not say which, so they are held to
 * the password like everyone else with it: one who never set one resets it
 * first (narduk-libs#1052). This is deliberate — skipping them would let any
 * `email`-provider session through with no proof.
 *
 * The sign-in that proves the password creates an upstream Supabase session;
 * it is signed out (`scope: 'local'`, that session only) before returning, so
 * a later failure does not leave it live.
 */
async function assertSupabaseCurrentPassword(
  event: H3Event,
  sessionUser: AppSessionUser,
  currentPassword: string | undefined,
  { missingMessage }: { missingMessage: string },
): Promise<void> {
  const requiresCurrentPassword =
    sessionUser.authProviders?.includes('email') &&
    !sessionUser.needsPasswordSetup &&
    !sessionUser.recoveryMode

  if (!requiresCurrentPassword) return

  if (!currentPassword) {
    throw createError({ statusCode: 400, statusMessage: missingMessage })
  }

  const verifier = createSupabaseUserClient(event)
  const verification = await verifier.signInWithPassword({
    email: sessionUser.email,
    password: currentPassword,
  })
  if (verification.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid current password.',
    })
  }

  const { error: signOutError } = await verifier.signOut({ scope: 'local' })
  if (signOutError) {
    useLogger(event)
      .child('AppAuth')
      .warn('Could not sign out the password-verification session', { error: signOutError })
  }
}

/**
 * How recently a session without a password must have signed in to delete its
 * account (narduk-libs#1052).
 */
export const RECENT_SIGN_IN_WINDOW_SECONDS = 10 * 60

/**
 * Recent re-authentication for a Supabase account that has no password to
 * prove (social sign-in only): the live `auth_sessions` row must have been
 * created — that is, the user completed a sign-in — within
 * `RECENT_SIGN_IN_WINDOW_SECONDS`. Token refresh keeps the row, so an old
 * session never becomes recent. Otherwise 403 `reauthentication_required`: the
 * client signs the user in again and retries.
 */
export async function assertRecentSupabaseSignIn(
  event: H3Event,
  sessionUser: AppSessionUser,
  now: Date = new Date(),
): Promise<void> {
  const row = sessionUser.authSessionId
    ? await loadAuthSessionRow(event, sessionUser.authSessionId)
    : null
  const signedInAt = row ? Date.parse(row.createdAt) : Number.NaN
  const ageSeconds = (now.getTime() - signedInAt) / 1000
  if (
    Number.isFinite(ageSeconds) &&
    ageSeconds >= 0 &&
    ageSeconds <= RECENT_SIGN_IN_WINDOW_SECONDS
  ) {
    return
  }
  throw createError({
    statusCode: 403,
    statusMessage: 'Sign in again to confirm it is you, then retry.',
    data: { code: 'reauthentication_required' },
  })
}

/**
 * The account-deletion credential check for a Supabase session, passed to
 * `deleteCurrentUserAccountBridge` as its `verifyCredentials` hook. It replaces
 * the local password-hash check, which a Supabase user cannot satisfy
 * (narduk-libs#923): an account with the `email` provider proves its Supabase
 * password, and a social-only one must have signed in recently
 * (`assertRecentSupabaseSignIn`, narduk-libs#1052).
 */
export async function verifySupabaseAccountDeletionCredentials(
  event: H3Event,
  input: { currentPassword?: string },
): Promise<void> {
  const sessionUser = await useRefreshedSessionUser(event)
  if (!sessionUser) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  if (!sessionUser.authProviders?.includes('email')) {
    await assertRecentSupabaseSignIn(event, sessionUser)
    return
  }

  await assertSupabaseCurrentPassword(event, sessionUser, input.currentPassword, {
    missingMessage: 'Current password is required to delete this account.',
  })
}

export async function changePassword(event: H3Event, body: ChangePasswordInput) {
  const config = getAuthConfig(event)
  const sessionUser = await useRefreshedSessionUser(event)
  if (!sessionUser) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  if (config.backend === 'supabase' && sessionUser.authSessionId) {
    await assertSupabaseCurrentPassword(event, sessionUser, body.currentPassword, {
      missingMessage: 'Current password is required for email-auth accounts.',
    })

    const context = await getCurrentSupabaseContext(event)
    const { data, error } = await context.client.updateUser({
      password: body.newPassword,
    })

    if (error) {
      toSupabaseHttpError(error)
    }

    await commitSupabaseSessionFromClient(event, {
      client: context.client,
      localUser: context.localUser,
      authUser: data.user,
      authSessionId: context.authSessionId,
      recoveryMode: false,
    })

    await replaceLayerUserSession(event, {
      user: {
        ...context.sessionUser,
        needsPasswordSetup: false,
        recoveryMode: false,
      },
    })

    // Keep this browser's session; stolen copies of other cookies die with their rows.
    await revokeUserAuthSessions(event, sessionUser.id, {
      exceptSessionId: sessionUser.authSessionId,
    })
    await clearAuthSessionRecoveryMode(event, sessionUser.authSessionId)

    return { success: true }
  }

  const db = useDatabase(event)
  const dbUser = await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.id, sessionUser.id)),
  )

  if (!dbUser?.passwordHash) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized — invalid user state',
    })
  }

  const isValid = await verifyUserPassword(body.currentPassword ?? '', dbUser.passwordHash)
  if (!isValid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid current password',
    })
  }

  const hashedPassword = await hashUserPassword(body.newPassword)
  await executeDatabaseQuery(
    db
      .update(users)
      .set({
        passwordHash: hashedPassword,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, sessionUser.id)),
  )

  if (useRuntimeConfig(event).authNativeClients?.length) {
    await useNativeAuth(event).revokeUser(sessionUser.id)
  }

  // Keep this browser's session; stolen copies of other cookies die with their rows.
  await revokeUserAuthSessions(event, sessionUser.id, {
    exceptSessionId: sessionUser.authSessionId,
  })
  await clearAuthSessionRecoveryMode(event, sessionUser.authSessionId)
  return { success: true }
}

export async function enrollMfa(
  event: H3Event,
  friendlyName?: string,
): Promise<MfaEnrollmentResult> {
  const context = await getCurrentSupabaseContext(event)
  const issuer = readRuntimeConfigString(useRuntimeConfig(event).public.appName, 'Narduk')
  const { data, error } = await context.client.mfa.enroll({
    factorType: 'totp',
    issuer,
    ...(friendlyName ? { friendlyName } : {}),
  })

  if (error) {
    toSupabaseHttpError(error)
  }

  return {
    factorId: data.id,
    qrCodeSvg: data.totp.qr_code,
    qrCodeDataUrl: encodeQrCodeDataUrl(data.totp.qr_code),
    secret: data.totp.secret,
    uri: data.totp.uri,
  }
}

export async function verifyMfa(event: H3Event, body: VerifyMfaInput) {
  const context = await getCurrentSupabaseContext(event)
  const { data, error } = await context.client.mfa.challengeAndVerify({
    factorId: body.factorId,
    code: body.code,
  })

  if (error) {
    toSupabaseHttpError(error)
  }

  const persisted = await commitSupabaseSessionFromClient(event, {
    client: context.client,
    localUser: context.localUser,
    authUser: data.user,
    authSessionId: context.authSessionId,
  })

  await replaceLayerUserSession(event, {
    user: {
      ...context.sessionUser,
      ...(persisted ? { aal: persisted.aal } : {}),
    },
  })

  return {
    success: true,
    // When the session could not be persisted (or carried no recognizable aal
    // claim), report the weaker assurance level rather than asserting aal2.
    aal: persisted?.aal ?? 'aal1',
  }
}
