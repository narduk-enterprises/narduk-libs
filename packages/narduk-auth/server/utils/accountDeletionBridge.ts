import { eq } from 'drizzle-orm'
import { createError } from 'h3'

import { users } from '#layer/orm-tables'
import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { verifyUserPassword } from '#layer/server/utils/password'
import { clearLayerUserSession } from '#layer/server/utils/user-session'

import type { AuthUser } from '#layer/server/utils/auth'
import type { H3Event } from 'h3'

export interface DeleteAccountBridgeInput {
  currentPassword?: string
}

/**
 * Extension hooks for the account deletion flow.
 *
 * Apps that back user identity with an external provider can supply
 * `beforeDelete` to clean up the upstream identity before the local DB row is
 * removed.
 */
export interface AccountDeletionBridgeHooks {
  beforeDelete?: (event: H3Event, userId: string) => Promise<void>
}

function isForeignKeyConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    /foreign key/i.test(error.message)
  )
}

export async function deleteCurrentUserAccountBridge(
  event: H3Event,
  user: AuthUser,
  input: DeleteAccountBridgeInput = {},
  hooks?: AccountDeletionBridgeHooks,
): Promise<void> {
  const log = useLogger(event).child('Auth')
  const db = useDatabase(event)
  const dbUser = await getDatabaseRow<typeof users.$inferSelect>(
    db.select().from(users).where(eq(users.id, user.id)),
  )

  if (!dbUser) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found.',
    })
  }

  if (dbUser.passwordHash) {
    if (!input.currentPassword) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Current password is required to delete this account.',
      })
    }

    const isValid = await verifyUserPassword(input.currentPassword, dbUser.passwordHash)
    if (!isValid) {
      log.warn('Account deletion rejected — invalid current password', { userId: user.id })
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid current password.',
      })
    }
  }

  if (hooks?.beforeDelete) {
    await hooks.beforeDelete(event, user.id)
  }

  try {
    await executeDatabaseQuery(db.delete(users).where(eq(users.id, user.id)))
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'Account deletion is blocked because app-owned records still reference this user. Configure downstream user foreign keys with ON DELETE CASCADE or clean them up before deleting the account.',
      })
    }

    throw error
  }

  await clearLayerUserSession(event)
  log.info('User deleted account', { userId: user.id })
}
