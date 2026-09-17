import { createError } from 'h3'

/**
 * Destructive and identity mutations are session-only.
 *
 * `requireAuth` accepts an API-key bearer as a first-class principal, and
 * `requireAuthScopes` no-ops when the required list is empty or the caller is
 * a session. A leaked `nk_` key minted with `scopes: []` would otherwise pass
 * those routes. Passkey add/remove already use this rule; account delete and
 * other identity changes must too.
 */
export function assertInteractiveSessionPrincipal(
  user: { authMethod?: string },
  action = 'This action',
): void {
  if (user.authMethod === 'api-key') {
    throw createError({
      statusCode: 403,
      statusMessage: `${action} requires an interactive session, not an API key.`,
    })
  }
}
