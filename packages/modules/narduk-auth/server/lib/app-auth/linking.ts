import { eq } from 'drizzle-orm'
import { createError } from 'h3'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { authUserLinks } from '#narduk-auth-server/app-orm-tables'
import { useAuthBridgeDatabase } from '#narduk-auth-server/utils/auth-bridge-database'
import { type User as LocalUser, users } from '#narduk-core/schema'

import { deriveDisplayName, extractProviderMetadata, normalizeEmail } from './helpers'

import type { User as SupabaseUser } from '@supabase/auth-js'
import type { H3Event } from 'h3'

interface EnsureLinkedLocalUserOptions {
  requireExistingLink?: boolean
  /** Never INSERT a users row — recovery must attach to an existing account. */
  requireExistingUser?: boolean
}

export async function ensureLinkedLocalUser(
  event: H3Event,
  authUser: SupabaseUser,
  options: EnsureLinkedLocalUserOptions = {},
): Promise<LocalUser> {
  const log = useLogger(event).child('AppAuth')
  const db = useDatabase(event)
  const appDb = useAuthBridgeDatabase(event)
  const normalizedEmail = normalizeEmail(authUser.email ?? '')
  if (!normalizedEmail) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Supabase user is missing a usable email address.',
    })
  }

  const metadata = extractProviderMetadata(authUser)
  const now = new Date().toISOString()
  const linked = await getDatabaseRow<typeof authUserLinks.$inferSelect>(
    appDb.select().from(authUserLinks).where(eq(authUserLinks.authUserId, authUser.id)),
  )

  if (options.requireExistingLink && !linked) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Public signup is disabled for this app.',
    })
  }

  let localUser: LocalUser | undefined

  if (linked) {
    localUser = await getDatabaseRow<LocalUser>(
      db.select().from(users).where(eq(users.id, linked.localUserId)),
    )
  }

  localUser ??= await getDatabaseRow<LocalUser>(
    db.select().from(users).where(eq(users.email, normalizedEmail)),
  )

  if (!localUser && metadata.appleId) {
    localUser = await getDatabaseRow<LocalUser>(
      db.select().from(users).where(eq(users.appleId, metadata.appleId)),
    )
  }

  if (!localUser) {
    if (options.requireExistingUser) {
      throw createError({
        statusCode: 403,
        statusMessage: 'This recovery link is not tied to an existing local account.',
      })
    }

    const newUserId = crypto.randomUUID()
    const fallbackName = metadata.displayName ?? deriveDisplayName(normalizedEmail)

    await db.insert(users).values({
      id: newUserId,
      email: normalizedEmail,
      name: fallbackName,
      appleId: metadata.appleId,
      passwordHash: null,
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    })

    localUser = await getDatabaseRow<LocalUser>(
      db.select().from(users).where(eq(users.id, newUserId)),
    )
  }

  if (!localUser) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to provision a local user for the shared auth identity.',
    })
  }

  const conflictingEmailUser =
    localUser.email !== normalizedEmail
      ? await getDatabaseRow<LocalUser>(
          db.select().from(users).where(eq(users.email, normalizedEmail)),
        )
      : null

  if (conflictingEmailUser && conflictingEmailUser.id !== localUser.id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This account cannot be linked automatically.',
    })
  }

  const existingLink = await getDatabaseRow<typeof authUserLinks.$inferSelect>(
    appDb.select().from(authUserLinks).where(eq(authUserLinks.localUserId, localUser.id)),
  )

  if (existingLink && existingLink.authUserId !== authUser.id) {
    log.warn('Rejected shared auth link takeover attempt', {
      attemptedAuthUserId: authUser.id,
      existingAuthUserId: existingLink.authUserId,
      localUserId: localUser.id,
      provider: metadata.primaryProvider,
    })
    throw createError({
      statusCode: 409,
      statusMessage: 'This account cannot be linked automatically.',
    })
  }

  const nextName = metadata.displayName ?? localUser.name ?? deriveDisplayName(normalizedEmail)
  const localUpdates: Partial<typeof users.$inferInsert> = {
    email: normalizedEmail,
    name: nextName,
    updatedAt: now,
  }

  if (metadata.appleId && !localUser.appleId) {
    localUpdates.appleId = metadata.appleId
  }

  await executeDatabaseQuery(db.update(users).set(localUpdates).where(eq(users.id, localUser.id)))

  const linkValues = {
    localUserId: localUser.id,
    authUserId: authUser.id,
    primaryEmail: normalizedEmail,
    lastProvider: metadata.primaryProvider,
    providersJson: JSON.stringify(metadata.providers),
    emailConfirmedAt: metadata.emailConfirmedAt,
    updatedAt: now,
  }

  if (existingLink) {
    await executeDatabaseQuery(
      appDb
        .update(authUserLinks)
        .set(linkValues)
        .where(eq(authUserLinks.localUserId, localUser.id)),
    )
  } else {
    await appDb.insert(authUserLinks).values({
      ...linkValues,
      createdAt: now,
    })
  }

  log.info('Linked shared auth user to local user', {
    authUserId: authUser.id,
    localUserId: localUser.id,
    provider: metadata.primaryProvider,
  })

  return {
    ...localUser,
    email: normalizedEmail,
    name: nextName,
    appleId: metadata.appleId ?? localUser.appleId,
    updatedAt: now,
  }
}
