import { createError, getRouterParam } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { defineUserMutation } from '#layer/server/utils/mutation'
import { RATE_LIMIT_POLICIES } from '#layer/server/utils/rateLimit'
import {
  assertPasskeyManagementPrincipal,
  deletePasskey,
} from '#narduk-auth-server/lib/app-auth/webauthn-core'
import { useNativeAuth } from '../../../utils/native-auth'

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
 *
 * Deleting a passkey also ends the native-app sessions the user signed in to
 * with a passkey (`POST /api/auth/native/passkey`), so a lost device's app
 * stops working with the credential (narduk-libs#2179). A native session does
 * not record which passkey minted it, so every passkey-minted session of this
 * user ends, not only the deleted one's. Sessions from Sign in with Apple or
 * the browser PKCE flow are untouched: they were not minted by a passkey.
 */
export default defineUserMutation(
  { rateLimit: RATE_LIMIT_POLICIES.authApiKeys },
  async ({ event, user }) => {
    assertPasskeyManagementPrincipal(user)
    const id = getRouterParam(event, 'id')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing passkey ID' })
    await deletePasskey(event, user.id, decodeURIComponent(id))
    if (useRuntimeConfig(event).authNativeClients?.length) {
      await useNativeAuth(event).revokeUserGrant(user.id, 'passkey')
    }
    return { success: true }
  },
)
