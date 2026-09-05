import { createError, getRouterParam } from 'h3'

import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import {
  assertPasskeyManagementPrincipal,
  deletePasskey,
} from '#narduk-auth-server/lib/app-auth/webauthn-core'

/**
 * DELETE /api/auth/passkeys/:id — remove one of the current user's passkeys.
 *
 * Scoped to the caller's own credentials by the `userId` predicate inside
 * `deletePasskey`; a credential belonging to anyone else reports 404 rather
 * than 403, so this route cannot be used to probe which credential IDs exist.
 *
 * Removing the last passkey is permitted: email + password remains the
 * break-glass path (D2, 2026-09-05), so an account with no passkey is not a
 * locked-out account.
 */
export default defineUserMutation(
  { rateLimit: RATE_LIMIT_POLICIES.authApiKeys },
  async ({ event, user }) => {
    assertPasskeyManagementPrincipal(user)
    const id = getRouterParam(event, 'id')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing passkey ID' })
    await deletePasskey(event, user.id, decodeURIComponent(id))
    return { success: true }
  },
)
