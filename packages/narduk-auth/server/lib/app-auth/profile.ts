import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { hashUserPassword, verifyUserPassword } from '#layer/server/utils/password'
import { replaceLayerUserSession } from '#layer/server/utils/user-session'
import { type User as LocalUser, users } from '#narduk-core/schema'

import { encodeQrCodeDataUrl } from './helpers'
import { ensureLinkedLocalUser } from './linking'
import {
  commitSupabaseSessionFromClient,
  getCurrentSessionUser,
  getCurrentSupabaseContext,
} from './session'
import {
  createSupabaseUserClient,
  getAuthConfig,
  readRuntimeConfigString,
  toSupabaseHttpError,
} from './supabase-client'

import type {
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

export async function changePassword(event: H3Event, body: ChangePasswordInput) {
  const config = getAuthConfig(event)
  const sessionUser = await getCurrentSessionUser(event)
  if (!sessionUser) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  if (config.backend === 'supabase' && sessionUser.authSessionId) {
    const requiresCurrentPassword =
      sessionUser.authProviders?.includes('email') &&
      !sessionUser.needsPasswordSetup &&
      !sessionUser.recoveryMode

    if (requiresCurrentPassword) {
      if (!body.currentPassword) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Current password is required for email-auth accounts.',
        })
      }

      const verifier = createSupabaseUserClient(event)
      const verification = await verifier.signInWithPassword({
        email: sessionUser.email,
        password: body.currentPassword,
      })
      if (verification.error) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Invalid current password.',
        })
      }
    }

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
    })

    await replaceLayerUserSession(event, {
      user: {
        ...context.sessionUser,
        needsPasswordSetup: false,
        recoveryMode: false,
      },
    })

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
    aal: persisted?.aal ?? 'aal2',
  }
}
