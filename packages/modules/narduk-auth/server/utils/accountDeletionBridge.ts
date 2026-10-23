import { eq } from 'drizzle-orm'
import { createError } from 'h3'

import { executeDatabaseQuery, getDatabaseRow, useDatabase } from '#layer/server/utils/database'
import { useLogger } from '#layer/server/utils/logger'
import { verifyUserPassword } from '#layer/server/utils/password'
import { clearLayerUserSession } from '#layer/server/utils/user-session'
import { users } from '#narduk-core/schema'

import {
  assertRecentSupabaseSignIn,
  verifySupabaseAccountDeletionCredentials,
} from '../lib/app-auth/profile'
import { getAuthConfig } from '../lib/app-auth/supabase-client'

import type { AuthUser } from '#layer/server/utils/auth'
import type { AppSessionUser } from '../lib/app-auth/types'
import type { H3Event } from 'h3'

export interface DeleteAccountBridgeInput {
  currentPassword?: string
}

/**
 * Extension hooks for the account deletion flow.
 *
 * Apps that back user identity with an external provider (e.g. Supabase Auth)
 * can supply `beforeDelete` to clean up the upstream identity before the local
 * DB row is removed. If the hook throws, the deletion is aborted and the local
 * user record is left intact.
 */
export interface AccountDeletionBridgeHooks {
  /**
   * Called after credential verification but before the local DB row is
   * deleted. Use this to remove the user from an external identity provider
   * (e.g. `supabase.admin.deleteUser`). Throwing here will abort the entire
   * deletion so the two sides stay in sync.
   */
  beforeDelete?: (event: H3Event, userId: string) => Promise<void>
  /**
   * Replaces the default credential check. Throw to refuse the deletion.
   *
   * Without it, a Supabase caller (a Supabase session, or any caller on a
   * Supabase-backend app) is re-authenticated against Supabase with
   * `verifySupabaseAccountDeletionCredentials` (narduk-libs#1051): the local
   * `users.password_hash` is absent for a Supabase-provisioned user (so the
   * local check would let `{}` through) and may be stale for a linked one
   * (narduk-libs#923). Everyone else gets the local hash check. Supply this
   * only to swap in a check of your own, e.g. when the route already
   * re-authenticated the caller. `context.userId` is the account about to be
   * deleted; passing `verifySupabaseAccountDeletionCredentials` here keeps its
   * session-to-account binding.
   */
  verifyCredentials?: (
    event: H3Event,
    input: DeleteAccountBridgeInput,
    context: { userId: string },
  ) => Promise<void>
}

/**
 * D1 puts "FOREIGN KEY constraint failed" on the error itself; Drizzle's
 * Postgres driver wraps the failure, so the message is the failed query and
 * the server's error (SQLSTATE 23503) sits on `cause`.
 */
function isForeignKeyConstraintError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && current.code === '23503') return true
    if (
      'message' in current &&
      typeof current.message === 'string' &&
      /foreign key/i.test(current.message)
    )
      return true
    current = 'cause' in current ? current.cause : null
  }
  return false
}

function usesSupabaseCredentials(event: H3Event, user: AuthUser): boolean {
  // A session names its backend; a principal that does not (an API key) takes
  // the app's, so a Supabase app never falls through to the local hash check.
  const sessionBackend = (user as { authBackend?: unknown }).authBackend
  if (sessionBackend === 'supabase' || sessionBackend === 'local') {
    return sessionBackend === 'supabase'
  }
  return getAuthConfig(event).backend === 'supabase'
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

  if (hooks?.verifyCredentials) {
    await hooks.verifyCredentials(event, input, { userId: user.id })
  } else if (usesSupabaseCredentials(event, user)) {
    await verifySupabaseAccountDeletionCredentials(event, input, { userId: user.id })
  } else if (dbUser.passwordHash) {
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
  } else {
    // No password to prove (local Sign in with Apple, magic link): the session
    // must have signed in recently, as a social-only Supabase account must.
    await assertRecentSupabaseSignIn(event, user as AppSessionUser)
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
